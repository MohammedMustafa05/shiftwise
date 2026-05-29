import type {
  GenerateScheduleResponse,
  ScheduleDetail,
  WorkplacePreferences,
} from "@shiftagent/shared";
import { UpdateShiftRequest } from "@shiftagent/shared";
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
  role: string;
}): string {
  const norm = (t: string) => t.slice(0, 5);
  return `${shift.employeeId}|${shift.shiftDate}|${norm(shift.startTime)}|${norm(shift.endTime)}|${shift.role}`;
}

function dedupeGeneratedShifts<T extends {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  role: string;
}>(shifts: T[]): T[] {
  const seen = new Set<string>();
  return shifts.filter((s) => {
    const key = shiftDedupeKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
        fullDayCapable: (e.profile_data as { fullDayCapable?: boolean }).fullDayCapable === true,
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
    if (prof && hours >= 10 && !prof.fullDayCapable) {
      const adjusted = { ...shift, startTime: "10:00", endTime: "16:00" };
      preferenceOverrides.push({
        employeeName: prof.name,
        suggested: shiftLabel({ ...shift, employeeName: prof.name }),
        scheduled: shiftLabel({ ...adjusted, employeeName: prof.name }),
        reason: "Employee is not full day capable",
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
  await assertAllEmployeesSubmitted(workplaceId, weekStart);

  const wp = await query<{ preferences: WorkplacePreferences }>(
    `SELECT preferences FROM workplaces WHERE id = $1`,
    [workplaceId]
  );
  if (wp.rows.length === 0) throw httpError(404, "Workplace not found");
  const preferences = wp.rows[0].preferences as WorkplacePreferences;

  const sales = await loadSalesForWorkplace(workplaceId);
  if (sales.length === 0) {
    throw httpError(400, "No sales data. Run Clearview sync or upload CSV first.");
  }

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
      block: a.block,
    }))
  );

  const llmSuggestedShifts = mlResult.shifts.map((s) => ({ ...s }));
  const { finalShifts, preferenceOverrides } = applyEmployeeSchedulingRules(
    mlResult.shifts,
    employees.rows
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
      JSON.stringify({
        workersNeeded: mlResult.workersNeeded,
        flags: mlResult.flags,
        llmSuggestedShifts,
        preferenceOverrides,
      }),
    ]
  );
  const scheduleId = scheduleInsert.rows[0].id;
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
         (schedule_id, employee_id, day_of_week, shift_date, start_time, end_time, role, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

  return {
    ...mlResult,
    scheduleId,
    shifts: persistedShifts,
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
    `SELECT id, employee_id, day_of_week, shift_date, start_time::text, end_time::text, role, location, is_locked
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
    })),
  };
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
