import type {
  EmployeeContext,
  GenerateScheduleResponse,
  LLMRole,
  MLHourlyPrediction,
  ManagerPreferencePattern,
  RecentScheduleContext,
  SchedulingPreferences,
  WorkplacePreferences,
} from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { remapSalesDateToScheduleWeek, roleTargetsForTotalWorkers } from "../utils/labourDemand.js";

export { remapSalesDateToScheduleWeek };

const PEAK_THRESHOLD = 1.4;
const DEFAULT_STAFFING_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type AvailabilityPayload = {
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

function toLLMRole(role: string): LLMRole {
  const r = role.trim().toUpperCase();
  if (r === "COOK") return "COOK";
  if (r === "PACKLINER" || r === "PACK") return "PACKLINER";
  return "CASHIER";
}

function preferredShiftType(
  value: unknown
): "MORNING" | "AFTERNOON" | "EVENING" | "ANY" {
  const v = String(value ?? "").toUpperCase();
  if (v === "MORNING" || v === "AFTERNOON" || v === "EVENING") return v;
  return "ANY";
}

export function buildMlPredictions(
  byHour: GenerateScheduleResponse["workersNeeded"]["byHour"],
  scheduleWeekStart: string
): MLHourlyPrediction[] {
  const withSales = byHour.filter((h) => h.sales > 0);
  const meanSales =
    withSales.length > 0
      ? withSales.reduce((sum, h) => sum + h.sales, 0) / withSales.length
      : 0;

  return byHour.map((h) => {
    const multiplier = meanSales > 0 ? h.sales / meanSales : 0;
    const roles = roleTargetsForTotalWorkers(h.workers);
    return {
      date: remapSalesDateToScheduleWeek(h.date, scheduleWeekStart),
      hour: h.hour,
      traffic_multiplier: Number(multiplier.toFixed(2)),
      recommended: { cook: roles.COOK, cash: roles.CASHIER, pack: roles.PACKLINER },
      is_peak: multiplier > PEAK_THRESHOLD,
    };
  });
}

/** Peak hours only, deduped by schedule date+hour, capped for prompt size. */
export function peakPredictionsForPrompt(
  predictions: MLHourlyPrediction[],
  maxPeaks = 32
): MLHourlyPrediction[] {
  const peaks = predictions.filter((p) => p.is_peak);
  peaks.sort((a, b) => b.traffic_multiplier - a.traffic_multiplier);
  const seen = new Set<string>();
  const out: MLHourlyPrediction[] = [];
  for (const p of peaks) {
    const key = `${p.date}:${p.hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= maxPeaks) break;
  }
  return out;
}

export function buildSchedulingPreferences(
  preferences: WorkplacePreferences
): SchedulingPreferences {
  const constraints = (preferences.constraints ?? {}) as Record<string, unknown>;
  const maxHours = (constraints.maxHoursPerWeek as number) ?? 45;

  const staffing: SchedulingPreferences["staffing_requirements"] = {};
  const roleReq = (constraints.roleRequirements ?? {}) as Record<string, unknown>;
  for (const [day, bands] of Object.entries(roleReq)) {
    if (!Array.isArray(bands)) continue;
    let cooks = 0;
    let cashiers = 0;
    let packliners = 0;
    for (const b of bands) {
      const band = b as Record<string, unknown>;
      cooks = Math.max(cooks, Number(band.cooks ?? 0));
      cashiers = Math.max(cashiers, Number(band.cashiers ?? 0));
      packliners = Math.max(packliners, Number(band.packliners ?? 0));
    }
    staffing[day.toLowerCase()] = {
      COOK: { min_count: cooks },
      CASHIER: { min_count: cashiers },
      PACKLINER: { min_count: packliners },
    };
  }

  if (Object.keys(staffing).length === 0) {
    for (const day of DEFAULT_STAFFING_DAYS) {
      staffing[day] = {
        COOK: { min_count: 1 },
        CASHIER: { min_count: 1 },
        PACKLINER: { min_count: 1 },
      };
    }
  }

  return {
    staffing_requirements: staffing,
    max_weekly_hours: maxHours,
    max_hours_per_employee: maxHours,
    overtime_threshold: (constraints.overtimeThreshold as number) ?? 40,
    overtime_rules: "FLAG_ONLY",
    rush_hour_priority: true,
  };
}

export async function loadEmployeeContexts(
  workplaceId: string,
  availability: AvailabilityPayload[],
  maxHoursDefault: number
): Promise<EmployeeContext[]> {
  const profiles = await query<{
    user_id: string;
    role: string;
    profile_data: Record<string, unknown> | null;
    rush_hour_suitability: string | number;
    performance_level: string | number;
    reliability_score: string | number;
    name: string;
  }>(
    `SELECT ep.user_id, ep.role, ep.profile_data,
            ep.rush_hour_suitability, ep.performance_level, ep.reliability_score,
            u.name
     FROM employee_profiles ep
     JOIN users u ON u.id = ep.user_id
     WHERE ep.workplace_id = $1`,
    [workplaceId]
  );

  const availByUser = new Map<string, EmployeeContext["availability"]>();
  for (const a of availability) {
    const list = availByUser.get(a.userId) ?? [];
    list.push({ day_of_week: a.dayOfWeek, start_time: a.startTime, end_time: a.endTime });
    availByUser.set(a.userId, list);
  }

  return profiles.rows.map((r) => {
    const pd = (r.profile_data ?? {}) as Record<string, unknown>;
    const rawRoles = (pd.roles as string[] | undefined) ?? [];
    const roles = rawRoles.length > 0 ? rawRoles.map((x) => toLLMRole(x)) : [toLLMRole(r.role)];
    return {
      id: r.user_id,
      name: r.name,
      role: toLLMRole(r.role),
      roles,
      availability: availByUser.get(r.user_id) ?? [],
      rush_hour_suitability: Number(r.rush_hour_suitability),
      performance_level: Number(r.performance_level),
      reliability_score: Number(r.reliability_score),
      preferred_shift_type: preferredShiftType(pd.preferredShiftType),
      min_hours_guaranteed: Number(pd.minHours ?? 0),
      max_hours: Number(pd.maxHours ?? maxHoursDefault),
      hours_scheduled_so_far: 0,
    };
  });
}

export async function loadRecentScheduleContext(
  workplaceId: string,
  currentWeekStart: string
): Promise<RecentScheduleContext[]> {
  try {
    const schedules = await query<{ id: string; week_start: Date | string }>(
      `SELECT id, week_start FROM schedules
       WHERE workplace_id = $1 AND status = 'published' AND week_start < $2
       ORDER BY week_start DESC LIMIT 6`,
      [workplaceId, currentWeekStart]
    );

    const out: RecentScheduleContext[] = [];
    for (const s of schedules.rows) {
      const overrides = await query<{ override_reason: string; notes: string | null }>(
        `SELECT override_reason, notes FROM schedule_overrides WHERE schedule_id = $1`,
        [s.id]
      );
      const log = await query<{ manager_edits_count: number | null }>(
        `SELECT manager_edits_count FROM llm_generation_log WHERE schedule_id = $1 LIMIT 1`,
        [s.id]
      );
      const exceptionTypes = ["one_time_exception", "event_special_occasion"];
      const wasException = overrides.rows.some((o) =>
        exceptionTypes.includes(o.override_reason)
      );
      const keyPatterns = overrides.rows
        .filter((o) => o.override_reason === "new_permanent_preference")
        .map((o) => o.notes)
        .filter((n): n is string => Boolean(n));

      out.push({
        week_start:
          s.week_start instanceof Date
            ? s.week_start.toISOString().slice(0, 10)
            : String(s.week_start).slice(0, 10),
        was_exception_week: wasException,
        manager_edits_count: log.rows[0]?.manager_edits_count ?? 0,
        key_patterns: keyPatterns,
      });
    }
    return out;
  } catch (err) {
    console.warn("[llmInput] loadRecentScheduleContext failed:", err);
    return [];
  }
}

export { toLLMRole };
