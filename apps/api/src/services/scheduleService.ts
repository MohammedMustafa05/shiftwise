import type {
  GenerateScheduleResponse,
  ScheduleDetail,
  WorkplacePreferences,
} from "@shiftagent/shared";
import { OverrideShiftRequestSchema, UpdateShiftRequest } from "@shiftagent/shared";
import type { z } from "zod";
import { query, getPool } from "../db/pool.js";
import { httpError } from "../middleware/errorHandler.js";
import { writeClearviewExportFile } from "../exports/clearview.js";
import { config } from "../config.js";
import { callMlEngine } from "./mlClient.js";
import { notifyWorkplaceEmployees } from "./notificationService.js";
import { formatDate, getPreviousWeekRange, parseTimeToHours } from "../utils/dates.js";
import { displayNameFromProfile, normalizeRole } from "../utils/employeeMap.js";
import { selectionsFromGrid } from "../utils/availabilityBlocks.js";
import { generateScheduleWithLLM } from "./llmPlanner.js";
import {
  buildMlPredictions,
  buildSchedulingPreferences,
  loadEmployeeContexts,
  loadRecentScheduleContext,
} from "./llmInput.js";
import {
  extractAIMistakePatterns,
  extractManagerPreferences,
  processNewOverride,
} from "./preferenceExtractor.js";
import {
  assertFloorCoverage,
  deduplicateFlags,
  runFloorEngineOnly,
  validateAndFill,
} from "./constraintSolver.js";
import {
  buildMinimalWorkersNeeded,
  remapWorkersNeededToScheduleWeek,
  scheduleWeekDates,
  applyRoleRequirements,
} from "../utils/labourDemand.js";

type ProfileRow = {
  user_id: string;
  name: string;
  profile_data: Record<string, unknown>;
};

function shiftDedupeKey(shift: {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
}): string {
  const norm = (t: string) => t.slice(0, 5);
  return `${shift.employeeId}|${shift.shiftDate}|${norm(shift.startTime)}|${norm(shift.endTime)}`;
}

/** Returns true if two time ranges overlap (midnight-crossing shifts use 24:00 for end). */
function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  // Treat "00:00" end as midnight (24*60) so overnight shifts compare correctly
  const normalize = (end: string) => (end.slice(0, 5) === "00:00" ? 24 * 60 : toMins(end));
  const as = toMins(aStart), ae = normalize(aEnd);
  const bs = toMins(bStart), be = normalize(bEnd);
  return as < be && bs < ae;
}

function dedupeGeneratedShifts<T extends {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  role: string;
}>(shifts: T[]): T[] {
  // First pass: remove exact duplicates (same employee, date, times)
  const seen = new Set<string>();
  const noDupes = shifts.filter((s) => {
    const key = shiftDedupeKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Second pass: remove overlapping shifts for the same employee on the same day.
  // Keep the first (longer / earlier) shift when two overlap.
  const kept: T[] = [];
  for (const shift of noDupes) {
    const overlaps = kept.some(
      (k) =>
        k.employeeId === shift.employeeId &&
        k.shiftDate === shift.shiftDate &&
        timeRangesOverlap(k.startTime, k.endTime, shift.startTime, shift.endTime)
    );
    if (!overlaps) kept.push(shift);
  }
  return kept;
}

function shiftLabel(shift: {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  role: string;
  employeeName?: string;
}): string {
  const name = shift.employeeName ?? "Employee";
  const role = normalizeRole(shift.role);
  return `${name} — ${role} ${shift.shiftDate} ${shift.startTime}–${shift.endTime}`;
}

function applyEmployeeSchedulingRules(
  shifts: GenerateScheduleResponse["shifts"],
  employees: ProfileRow[]
) {
  const byUser = new Map(
    employees.map((e) => [
      e.user_id,
      {
        name: displayNameFromProfile(e.name, e.profile_data ?? {}),
        lightShiftOnly:
          (e.profile_data as { shiftTier?: string; experienceLevel?: string }).shiftTier ===
            "Light shifts" ||
          (e.profile_data as { experienceLevel?: string }).experienceLevel === "Trainee",
      },
    ])
  );
  const preferenceOverrides: Array<{
    employeeName: string;
    suggested: string;
    scheduled: string;
    reason: string;
  }> = [];
  const finalShifts: GenerateScheduleResponse["shifts"] = [];

  for (const shift of shifts) {
    const prof = byUser.get(shift.employeeId);
    const hours = parseTimeToHours(shift.startTime, shift.endTime);
    // Only cap trainee/light-shift employees — do not truncate full coverage blocks for veterans.
    if (prof?.lightShiftOnly && hours > 8) {
      const [sh, sm] = shift.startTime.split(":").map((n) => parseInt(n, 10));
      const endTotal = sh * 60 + (sm || 0) + 8 * 60;
      const endH = Math.floor(endTotal / 60) % 24;
      const endM = endTotal % 60;
      const adjusted = {
        ...shift,
        endTime: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
      };
      preferenceOverrides.push({
        employeeName: prof.name,
        suggested: shiftLabel({ ...shift, employeeName: prof.name }),
        scheduled: shiftLabel({ ...adjusted, employeeName: prof.name }),
        reason: "Trainee/light shift capped at 8 hours",
      });
      finalShifts.push(adjusted);
    } else {
      finalShifts.push(shift);
    }
  }

  return { finalShifts, preferenceOverrides };
}

type SubmissionAvailability = {
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  block?: string;
};

async function assertAllEmployeesSubmitted(workplaceId: string, weekStart: string) {
  const employees = await query<{ user_id: string; name: string }>(
    `SELECT u.id AS user_id, u.name
     FROM users u
     JOIN employee_profiles ep ON ep.user_id = u.id
     WHERE ep.workplace_id = $1 AND u.role = 'EMPLOYEE'`,
    [workplaceId]
  );
  const submissions = await query<{ user_id: string }>(
    `SELECT user_id FROM availability_submissions
     WHERE workplace_id = $1 AND week_start = $2 AND status IN ('pending', 'approved')`,
    [workplaceId, weekStart]
  );
  const submitted = new Set(submissions.rows.map((r) => r.user_id));
  const missing = employees.rows.filter((e) => !submitted.has(e.user_id));
  if (missing.length > 0) {
    throw httpError(
      400,
      `Cannot generate schedule until every employee submits availability. Missing: ${missing.map((m) => m.name).join(", ")}`
    );
  }
}

async function loadAvailabilityFromSubmissions(
  workplaceId: string,
  weekStart: string
): Promise<SubmissionAvailability[]> {
  const result = await query<{ user_id: string; availability_grid: Record<string, unknown> }>(
    `SELECT user_id, availability_grid FROM availability_submissions
     WHERE workplace_id = $1 AND week_start = $2 AND status IN ('pending', 'approved')`,
    [workplaceId, weekStart]
  );
  const blocks: SubmissionAvailability[] = [];
  for (const row of result.rows) {
    for (const s of selectionsFromGrid(row.availability_grid ?? {})) {
      if (s.block !== "off") {
        blocks.push({
          userId: row.user_id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          block: s.block,
        });
      }
    }
  }
  return blocks;
}

export async function loadSalesForWorkplace(workplaceId: string): Promise<
  Array<{ date: string; hour: number; salesAmount: number }>
> {
  const { weekStart, weekEnd } = getPreviousWeekRange();
  const result = await query<{ sale_date: Date; hour: number; sales_amount: string }>(
    `SELECT sale_date, hour, sales_amount FROM hourly_sales_data
     WHERE workplace_id = $1 AND sale_date >= $2 AND sale_date <= $3
     ORDER BY sale_date, hour`,
    [workplaceId, weekStart, weekEnd]
  );
  return result.rows.map((r) => ({
    date:
      r.sale_date instanceof Date
        ? r.sale_date.toISOString().slice(0, 10)
        : String(r.sale_date).slice(0, 10),
    hour: r.hour,
    salesAmount: parseFloat(r.sales_amount),
  }));
}

export async function generateSchedule(
  workplaceId: string,
  weekStart: string
): Promise<GenerateScheduleResponse> {
  // Prevent overwriting a published schedule with a new generation run
  const publishedCheck = await query<{ status: string }>(
    `SELECT status FROM schedules WHERE workplace_id = $1 AND week_start = $2`,
    [workplaceId, weekStart]
  );
  if (publishedCheck.rows[0]?.status === "published") {
    throw httpError(409, "A published schedule already exists for this week. Unpublish it before regenerating.");
  }

  await assertAllEmployeesSubmitted(workplaceId, weekStart);

  const wp = await query<{ preferences: WorkplacePreferences }>(
    `SELECT preferences FROM workplaces WHERE id = $1`,
    [workplaceId]
  );
  if (wp.rows.length === 0) throw httpError(404, "Workplace not found");
  const preferences = wp.rows[0].preferences as WorkplacePreferences;

  // Sales data is loaded by the ML engine directly from its XLS folder.
  // We still query the DB so it can serve as a fallback inside callMlEngine,
  // but an empty result is no longer a hard stop.
  const sales = await loadSalesForWorkplace(workplaceId);

  const employees = await query<{
    id: string;
    user_id: string;
    role: string;
    employee_number: string | null;
    payroll_department: string | null;
    job_code: string | null;
    name: string;
    email: string;
    profile_data: Record<string, unknown>;
  }>(
    `SELECT ep.id, ep.user_id, ep.role, ep.employee_number, ep.payroll_department, ep.job_code,
            ep.profile_data, u.name, u.email
     FROM employee_profiles ep
     JOIN users u ON u.id = ep.user_id
     WHERE ep.workplace_id = $1`,
    [workplaceId]
  );

  const submissionAvailability = await loadAvailabilityFromSubmissions(workplaceId, weekStart);

  const mlResult = await callMlEngine(
    workplaceId,
    weekStart,
    sales,
    preferences,
    employees.rows.map((e) => ({
      id: e.id,
      userId: e.user_id,
      workplaceId,
      name: e.name,
      email: e.email,
      role: e.role,
      employeeNumber: e.employee_number,
      payrollDepartment: e.payroll_department,
      jobCode: e.job_code,
    })),
    submissionAvailability.map((a) => ({
      userId: a.userId,
      dayOfWeek: a.dayOfWeek,
      startTime: a.startTime,
      endTime: a.endTime,
      block: a.block as "morning" | "evening" | "full" | "off" | undefined,
    }))
  );

  const scheduleInsert = await query<{ id: string }>(
    `INSERT INTO schedules (workplace_id, week_start, status, ml_metadata)
     VALUES ($1, $2, 'draft', $3)
     ON CONFLICT (workplace_id, week_start)
     DO UPDATE SET status = 'draft', ml_metadata = EXCLUDED.ml_metadata, updated_at = now()
     RETURNING id`,
    [
      workplaceId,
      weekStart,
      JSON.stringify({ workersNeeded: mlResult.workersNeeded, flags: mlResult.flags }),
    ]
  );
  const scheduleId = scheduleInsert.rows[0].id;

  const constraints = (preferences.constraints ?? {}) as Record<string, unknown>;
  const maxHoursDefault = (constraints.maxHoursPerWeek as number) ?? 45;

  let workersNeededForWeek = remapWorkersNeededToScheduleWeek(mlResult.workersNeeded, weekStart);
  if (workersNeededForWeek.byHour.length === 0 && workersNeededForWeek.byDay.length === 0) {
    workersNeededForWeek = buildMinimalWorkersNeeded(weekStart);
  }

  const approvedTimeOff = await query<{ user_id: string; start_date: Date | string; end_date: Date | string }>(
    `SELECT user_id, start_date, end_date FROM time_off_requests
     WHERE workplace_id = $1 AND status = 'approved'
       AND start_date <= ($2::date + interval '6 days')::date
       AND end_date >= $2::date`,
    [workplaceId, weekStart]
  );

  const solverEmployees = employees.rows.map((e) => {
    const pd = (e.profile_data ?? {}) as {
      roles?: string[];
      maxHours?: number;
      minHours?: number;
      minShiftsPerWeek?: number;
    };
    const profileRoles = (pd.roles ?? []).map((r) => {
      const upper = String(r).trim().toUpperCase();
      if (upper === "COOK" || upper === "CASHIER" || upper === "PACKLINER") return upper;
      if (r === "Cook") return "COOK";
      if (r === "Cashier") return "CASHIER";
      if (r === "Packliner") return "PACKLINER";
      return upper;
    });
    return {
      user_id: e.user_id,
      role: e.role,
      roles: profileRoles.length > 0 ? profileRoles : [e.role],
      max_hours: Number(pd.maxHours ?? maxHoursDefault),
      min_hours: Number(pd.minHours ?? 0),
      min_shifts: Number(pd.minShiftsPerWeek ?? 0),
    };
  });

  const solverAvailability = submissionAvailability.map((a) => ({
    user_id: a.userId,
    day_of_week: a.dayOfWeek,
    start_time: a.startTime,
    end_time: a.endTime,
  }));

  const solverTimeOff = approvedTimeOff.rows.map((r) => ({
    user_id: r.user_id,
    start_date:
      r.start_date instanceof Date
        ? r.start_date.toISOString().slice(0, 10)
        : String(r.start_date).slice(0, 10),
    end_date:
      r.end_date instanceof Date
        ? r.end_date.toISOString().slice(0, 10)
        : String(r.end_date).slice(0, 10),
  }));

  const solverParams = {
    weekStart,
    workersNeeded: workersNeededForWeek,
    employees: solverEmployees,
    availability: solverAvailability,
    approvedTimeOff: solverTimeOff,
    preferences,
  };

  // Phase 1: floor engine runs before LLM — mandatory 1+1+1 per operating hour
  const floorResult = runFloorEngineOnly(solverParams);

  const [managerPrefs, mistakePatterns, recentSchedules, employeeContexts] = await Promise.all([
    extractManagerPreferences(workplaceId),
    extractAIMistakePatterns(workplaceId),
    loadRecentScheduleContext(workplaceId, weekStart),
    loadEmployeeContexts(workplaceId, submissionAvailability, maxHoursDefault),
  ]);

  const llmInput = {
    workplace_id: workplaceId,
    week_start: weekStart,
    scheduling_preferences: buildSchedulingPreferences(preferences),
    ml_predictions: buildMlPredictions(mlResult.workersNeeded.byHour, weekStart),
    workers_needed: workersNeededForWeek,
    employees: employeeContexts,
    manager_preferences: managerPrefs,
    ai_mistake_patterns: mistakePatterns,
    recent_schedules: recentSchedules,
    scheduling_prior: mlResult.schedulingPrior as Record<string, unknown> | undefined,
    floor_assignments: floorResult.shifts.map((s) => ({
      employee_id: s.employeeId,
      date: s.shiftDate,
      start_time: s.startTime,
      end_time: s.endTime,
      role: s.role as "COOK" | "CASHIER" | "PACKLINER",
    })),
    floor_gaps: floorResult.gaps.map((g) => ({
      code: g.code,
      date: g.date,
      hour: g.hour,
      role: g.role,
      detail: g.detail,
    })),
  };

  const llmOutput = await generateScheduleWithLLM(llmInput, scheduleId);

  const floorBaselineShifts = floorResult.shifts.map((s) => ({
    id: crypto.randomUUID(),
    employeeId: s.employeeId,
    day: s.day,
    shiftDate: s.shiftDate,
    startTime: s.startTime,
    endTime: s.endTime,
    role: s.role,
    location: s.location ?? "Main",
    isEngineSuggested: s.isEngineSuggested ?? true,
    llmReasoning: s.llmReasoning,
  }));

  const { shifts: validatedShifts, violationsFixed, roleCoverageGaps, hardFlags, preferenceOverrideFlags } = validateAndFill({
    llmSuggestions: llmOutput.shifts,
    baselineShifts: [...floorBaselineShifts, ...mlResult.shifts],
    ...solverParams,
  });

  const mappedShifts = validatedShifts.map((s) => ({
    id: crypto.randomUUID(),
    employeeId: s.employeeId,
    day: s.day,
    shiftDate: s.shiftDate,
    startTime: s.startTime,
    endTime: s.endTime,
    role: s.role,
    location: s.location,
    isEngineSuggested: s.isEngineSuggested,
    llmReasoning: s.llmReasoning,
  }));

  const { finalShifts: afterPrefs, preferenceOverrides } = applyEmployeeSchedulingRules(
    mappedShifts,
    employees.rows
  );

  // Re-enforce 1 cook + 1 cash + 1 pack per hour after preference rules (avoids undoing solver coverage).
  const {
    shifts: coverageFixedShifts,
    violationsFixed: coverageFixes,
    roleCoverageGaps: gapsAfterPrefs,
    hardFlags: hardFlagsAfterPrefs,
  } = validateAndFill({
    llmSuggestions: [],
    baselineShifts: afterPrefs.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      day: s.day,
      shiftDate: s.shiftDate,
      startTime: s.startTime,
      endTime: s.endTime,
      role: s.role,
      location: s.location ?? "Main",
      isEngineSuggested: s.isEngineSuggested,
      llmReasoning: s.llmReasoning,
    })),
    ...solverParams,
  });

  const finalShifts = coverageFixedShifts.map((s) => ({
    id: crypto.randomUUID(),
    employeeId: s.employeeId,
    day: s.day,
    shiftDate: s.shiftDate,
    startTime: s.startTime,
    endTime: s.endTime,
    role: s.role,
    location: s.location,
    isEngineSuggested: s.isEngineSuggested,
    llmReasoning: s.llmReasoning,
  }));

  const allCoverageGaps = [...new Set([...roleCoverageGaps, ...gapsAfterPrefs])];
  const allHardFlags = deduplicateFlags([...hardFlags, ...hardFlagsAfterPrefs]);

  await query(
    `UPDATE schedules SET ml_metadata = $2, updated_at = now() WHERE id = $1`,
    [
      scheduleId,
      JSON.stringify({
        workersNeeded: mlResult.workersNeeded,
        flags: mlResult.flags,
        schedulingPrior: mlResult.schedulingPrior,
        llmSummary: llmOutput.summary,
        llmWarnings: [
          ...llmOutput.warnings,
          ...allCoverageGaps.map((g) => `Coverage gap: ${g}`),
          ...allHardFlags.map((f) => f.detail),
        ],
        roleCoverageGaps: allCoverageGaps,
        hardFlags: allHardFlags,
        canPublish: allHardFlags.length === 0,
        violationsFixed: violationsFixed + coverageFixes,
        preferenceOverrides,
        roleRequirementOverrides: preferenceOverrideFlags,
        // Surface what the LLM recommended so the UI's "AI Suggestions" panel can
        // diff it against the final (solver-adjusted) schedule.
        llmSuggestedShifts: llmOutput.shifts.map((s) => ({
          employeeId: s.employee_id,
          shiftDate: s.date,
          startTime: s.start_time,
          endTime: s.end_time,
          role: s.role,
        })),
      }),
    ]
  );

  const uniqueShifts = dedupeGeneratedShifts(finalShifts);

  const pool = getPool();
  const client = await pool.connect();
  const persistedShifts: GenerateScheduleResponse["shifts"] = [];
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM schedule_shifts WHERE schedule_id = $1`, [scheduleId]);
    for (const shift of uniqueShifts) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO schedule_shifts
         (schedule_id, employee_id, day_of_week, shift_date, start_time, end_time, role, location,
          is_engine_suggested, llm_reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          scheduleId,
          shift.employeeId,
          ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].indexOf(shift.day) >= 0
            ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].indexOf(shift.day)
            : 0,
          shift.shiftDate,
          shift.startTime,
          shift.endTime,
          shift.role,
          shift.location ?? "Main",
          (shift as { isEngineSuggested?: boolean }).isEngineSuggested ?? false,
          (shift as { llmReasoning?: string | null }).llmReasoning ?? null,
        ]
      );
      persistedShifts.push({ ...shift, id: ins.rows[0].id });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  assertFloorCoverage(
    uniqueShifts.map((s) => ({
      employeeId: s.employeeId,
      day: s.day,
      shiftDate: s.shiftDate,
      startTime: s.startTime,
      endTime: s.endTime,
      role: s.role,
      location: s.location ?? "Main",
      isEngineSuggested: s.isEngineSuggested ?? false,
      llmReasoning: s.llmReasoning ?? null,
    })),
    scheduleWeekDates(weekStart)
  );

  const overrideFlags = preferenceOverrideFlags.length > 0
    ? preferenceOverrideFlags.map((f) => ({
        type: "preference_override" as const,
        date: f.date,
        hour: f.hour,
        message: f.message,
      }))
    : [];

  return {
    ...mlResult,
    scheduleId,
    shifts: persistedShifts,
    flags: [...(mlResult.flags ?? []), ...overrideFlags],
  };
}

export async function getScheduleDetail(
  scheduleId: string,
  workplaceId: string
): Promise<ScheduleDetail> {
  const sched = await query<{
    id: string;
    workplace_id: string;
    week_start: Date;
    status: string;
    ml_metadata: Record<string, unknown>;
    exported_at: Date | null;
    last_sales_sync_at: Date | null;
  }>(
    `SELECT s.id, s.workplace_id, s.week_start, s.status, s.ml_metadata, s.exported_at,
            c.last_sales_sync_at
     FROM schedules s
     JOIN workplaces w ON w.id = s.workplace_id
     LEFT JOIN clearview_connections c ON c.workplace_id = w.id
     WHERE s.id = $1 AND s.workplace_id = $2`,
    [scheduleId, workplaceId]
  );
  if (sched.rows.length === 0) throw httpError(404, "Schedule not found");

  const shifts = await query(
    `SELECT id, employee_id, day_of_week, shift_date, start_time::text, end_time::text, role, location,
            is_locked, is_engine_suggested, llm_reasoning
     FROM schedule_shifts WHERE schedule_id = $1`,
    [scheduleId]
  );

  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const row = sched.rows[0];
  const seen = new Set<string>();
  const uniqueShiftRows = shifts.rows.filter((s) => {
    const shiftDate =
      s.shift_date instanceof Date
        ? s.shift_date.toISOString().slice(0, 10)
        : String(s.shift_date).slice(0, 10);
    const key = `${s.employee_id}|${shiftDate}|${s.start_time.slice(0, 5)}|${s.end_time.slice(0, 5)}|${s.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    id: row.id,
    workplaceId: row.workplace_id,
    weekStart: row.week_start instanceof Date ? formatDate(row.week_start) : String(row.week_start).slice(0, 10),
    status: row.status as "draft" | "published",
    mlMetadata: row.ml_metadata ?? {},
    lastSalesSyncAt: row.last_sales_sync_at?.toISOString() ?? null,
    exportedAt: row.exported_at?.toISOString() ?? null,
    shifts: uniqueShiftRows.map((s) => ({
      id: s.id,
      employeeId: s.employee_id,
      day: days[s.day_of_week] ?? "MON",
      shiftDate:
        s.shift_date instanceof Date
          ? s.shift_date.toISOString().slice(0, 10)
          : String(s.shift_date).slice(0, 10),
      startTime: s.start_time.slice(0, 5),
      endTime: s.end_time.slice(0, 5),
      role: s.role,
      location: s.location,
      isLocked: s.is_locked ?? false,
      isEngineSuggested: s.is_engine_suggested ?? false,
      llmReasoning: s.llm_reasoning ?? null,
    })),
  };
}

export async function overrideShift(
  scheduleId: string,
  shiftId: string,
  workplaceId: string,
  managerId: string,
  body: z.infer<typeof OverrideShiftRequestSchema>
): Promise<ScheduleDetail> {
  const sched = await query<{ id: string }>(
    `SELECT id FROM schedules WHERE id = $1 AND workplace_id = $2 AND status = 'draft'`,
    [scheduleId, workplaceId]
  );
  if (sched.rows.length === 0) throw httpError(404, "Draft schedule not found");

  const existing = await query<{
    employee_id: string;
    shift_date: Date | string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    role: string;
    is_engine_suggested: boolean;
  }>(
    `SELECT employee_id, shift_date, day_of_week, start_time::text, end_time::text, role, is_engine_suggested
     FROM schedule_shifts WHERE id = $1 AND schedule_id = $2`,
    [shiftId, scheduleId]
  );
  if (existing.rows.length === 0) throw httpError(404, "Shift not found");

  const row = existing.rows[0];
  const newEmployeeId = body.employeeId ?? row.employee_id;
  const newStart = body.startTime ?? row.start_time.slice(0, 5);
  const newEnd = body.endTime ?? row.end_time.slice(0, 5);
  const newRole = body.role ?? row.role;

  await query(
    `UPDATE schedule_shifts
     SET employee_id = $1, start_time = $2, end_time = $3, role = $4, updated_at = now()
     WHERE id = $5 AND schedule_id = $6`,
    [newEmployeeId, newStart, newEnd, newRole, shiftId, scheduleId]
  );

  const shiftDate =
    row.shift_date instanceof Date
      ? row.shift_date.toISOString().slice(0, 10)
      : String(row.shift_date).slice(0, 10);

  await query(
    `INSERT INTO schedule_overrides
     (schedule_id, shift_id, workplace_id, manager_id, override_reason,
      original_employee_id, new_employee_id, original_start_time, new_start_time,
      original_end_time, new_end_time, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      scheduleId,
      shiftId,
      workplaceId,
      managerId,
      body.overrideReason,
      row.employee_id,
      newEmployeeId,
      row.start_time.slice(0, 5),
      newStart,
      row.end_time.slice(0, 5),
      newEnd,
      body.notes ?? null,
    ]
  );

  if (row.is_engine_suggested) {
    await processNewOverride({
      workplaceId,
      overrideReason: body.overrideReason,
      originalEmployeeId: row.employee_id,
      newEmployeeId,
      shiftDate,
      dayOfWeek: row.day_of_week,
      startTime: newStart,
      endTime: newEnd,
      role: newRole,
      notes: body.notes,
    });
  }

  return getScheduleDetail(scheduleId, workplaceId);
}

export async function getScheduleByWeek(
  workplaceId: string,
  weekStart: string
): Promise<ScheduleDetail | null> {
  const sched = await query<{ id: string }>(
    `SELECT id FROM schedules WHERE workplace_id = $1 AND week_start = $2`,
    [workplaceId, weekStart]
  );
  if (sched.rows.length === 0) return null;
  return getScheduleDetail(sched.rows[0].id, workplaceId);
}

export async function updateShift(
  scheduleId: string,
  shiftId: string,
  workplaceId: string,
  body: z.infer<typeof UpdateShiftRequest>
): Promise<void> {
  const sched = await query(`SELECT id FROM schedules WHERE id = $1 AND workplace_id = $2 AND status = 'draft'`, [
    scheduleId,
    workplaceId,
  ]);
  if (sched.rows.length === 0) throw httpError(404, "Draft schedule not found");

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (body.startTime) {
    fields.push(`start_time = $${i++}`);
    values.push(body.startTime);
  }
  if (body.endTime) {
    fields.push(`end_time = $${i++}`);
    values.push(body.endTime);
  }
  if (body.role) {
    fields.push(`role = $${i++}`);
    values.push(body.role);
  }
  if (body.location !== undefined) {
    fields.push(`location = $${i++}`);
    values.push(body.location);
  }
  if (body.employeeId) {
    fields.push(`employee_id = $${i++}`);
    values.push(body.employeeId);
  }
  if (body.isLocked !== undefined) {
    fields.push(`is_locked = $${i++}`);
    values.push(body.isLocked);
  }
  if (fields.length === 0) return;

  values.push(shiftId, scheduleId);
  await query(
    `UPDATE schedule_shifts SET ${fields.join(", ")}, updated_at = now()
     WHERE id = $${i++} AND schedule_id = $${i}`,
    values
  );
}

export async function createShift(
  scheduleId: string,
  workplaceId: string,
  body: {
    employeeId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    role: string;
    location?: string;
    isLocked?: boolean;
  }
): Promise<{ id: string }> {
  const sched = await query<{ week_start: Date }>(
    `SELECT week_start FROM schedules WHERE id = $1 AND workplace_id = $2 AND status = 'draft'`,
    [scheduleId, workplaceId]
  );
  if (sched.rows.length === 0) throw httpError(404, "Draft schedule not found");

  const shiftDate = new Date(body.shiftDate + "T12:00:00");
  const dayOfWeek = shiftDate.getDay();

  // Reject if an existing shift for this employee on this date overlaps the new one
  const existing = await query<{ start_time: string; end_time: string }>(
    `SELECT ss.start_time::text, ss.end_time::text
     FROM schedule_shifts ss
     WHERE ss.schedule_id = $1 AND ss.employee_id = $2 AND ss.shift_date = $3`,
    [scheduleId, body.employeeId, body.shiftDate]
  );
  for (const ex of existing.rows) {
    if (timeRangesOverlap(body.startTime, body.endTime, ex.start_time.slice(0, 5), ex.end_time.slice(0, 5))) {
      throw httpError(
        409,
        `Employee already has an overlapping shift on ${body.shiftDate} (${ex.start_time.slice(0, 5)}–${ex.end_time.slice(0, 5)})`
      );
    }
  }

  const ins = await query<{ id: string }>(
    `INSERT INTO schedule_shifts
     (schedule_id, employee_id, day_of_week, shift_date, start_time, end_time, role, location, is_locked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      scheduleId,
      body.employeeId,
      dayOfWeek,
      body.shiftDate,
      body.startTime,
      body.endTime,
      body.role,
      body.location ?? "Main",
      body.isLocked ?? false,
    ]
  );
  return { id: ins.rows[0].id };
}

export async function deleteShift(
  scheduleId: string,
  shiftId: string,
  workplaceId: string
): Promise<void> {
  const sched = await query(
    `SELECT id FROM schedules WHERE id = $1 AND workplace_id = $2 AND status = 'draft'`,
    [scheduleId, workplaceId]
  );
  if (sched.rows.length === 0) throw httpError(404, "Draft schedule not found");
  await query(`DELETE FROM schedule_shifts WHERE id = $1 AND schedule_id = $2`, [shiftId, scheduleId]);
}

export async function publishSchedule(
  scheduleId: string,
  workplaceId: string
): Promise<{ schedule: ScheduleDetail; downloadUrl: string }> {
  const existing = await query<{ status: string }>(
    `SELECT status FROM schedules WHERE id = $1 AND workplace_id = $2`,
    [scheduleId, workplaceId]
  );
  if (existing.rows.length === 0) throw httpError(404, "Schedule not found");
  if (existing.rows[0].status === "published") throw httpError(409, "Schedule is already published");

  const filePath = await writeClearviewExportFile(scheduleId, config.exportsDir);
  const filename = filePath.split("/").pop()!;

  await query(
    `UPDATE schedules SET status = 'published', exported_at = now(),
     clearview_export_path = $3, updated_at = now()
     WHERE id = $1 AND workplace_id = $2`,
    [scheduleId, workplaceId, filePath]
  );

  const schedule = await getScheduleDetail(scheduleId, workplaceId);

  await notifyWorkplaceEmployees(
    workplaceId,
    "schedule_published",
    "Weekly schedule is live",
    "/(tabs)/schedule",
    scheduleId
  );

  return {
    schedule,
    downloadUrl: `/api/schedules/${scheduleId}/export/clearview`,
  };
}
