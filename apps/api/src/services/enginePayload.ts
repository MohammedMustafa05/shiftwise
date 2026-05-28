import type {
  EngineGenerateRequest,
  EngineSalesRow,
  RoleRequirementsByDay,
  WorkplacePreferences,
} from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { httpError } from "../middleware/errorHandler.js";
import { normalizeRole } from "../utils/employeeMap.js";
import { addDays, formatDate, getPreviousWeekRange, getWeekStart } from "../utils/dates.js";

const DAY_NAMES_LOWER = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function normalizeRoleRequirements(raw: unknown): RoleRequirementsByDay {
  if (!raw || typeof raw !== "object") return {};
  const out: RoleRequirementsByDay = {};
  for (const [key, bands] of Object.entries(raw as Record<string, unknown>)) {
    const dayKey = key.toLowerCase();
    if (!Array.isArray(bands)) continue;
    out[dayKey] = bands.map((b) => {
      const band = b as Record<string, unknown>;
      return {
        from: String(band.from ?? "00:00"),
        to: String(band.to ?? "23:59"),
        cashiers: Number(band.cashiers ?? 0),
        cooks: Number(band.cooks ?? 0),
        packliners: Number(band.packliners ?? 0),
      };
    });
  }
  return out;
}

/** Map reference-week sales rows onto target week dates (same DOW + hour). */
export function mapSalesToTargetWeek(
  referenceSales: Array<{ date: string; hour: number; salesAmount: number }>,
  weekStart: string
): EngineSalesRow[] {
  const anchor = getWeekStart(new Date(`${weekStart}T12:00:00Z`));
  const byDowHour = new Map<string, number>();
  for (const row of referenceSales) {
    const d = new Date(`${row.date}T12:00:00Z`);
    const dow = d.getUTCDay();
    byDowHour.set(`${dow}:${row.hour}`, row.salesAmount);
  }

  const mapped: EngineSalesRow[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = formatDate(addDays(anchor, offset));
    const dow = addDays(anchor, offset).getUTCDay();
    for (let hour = 0; hour < 24; hour++) {
      const sales = byDowHour.get(`${dow}:${hour}`) ?? 0;
      mapped.push({ date, hour, sales_amount: sales });
    }
  }
  return mapped;
}

type SalesRowDb = { sale_date: Date; hour: number; sales_amount: string };

async function querySalesRange(
  workplaceId: string,
  from: string,
  to: string
): Promise<Array<{ date: string; hour: number; salesAmount: number }>> {
  const salesRows = await query<SalesRowDb>(
    `SELECT sale_date, hour, sales_amount FROM hourly_sales_data
     WHERE workplace_id = $1 AND sale_date >= $2 AND sale_date <= $3
     ORDER BY sale_date, hour`,
    [workplaceId, from, to]
  );
  return salesRows.rows.map((r) => ({
    date:
      r.sale_date instanceof Date
        ? r.sale_date.toISOString().slice(0, 10)
        : String(r.sale_date).slice(0, 10),
    hour: r.hour,
    salesAmount: parseFloat(r.sales_amount),
  }));
}

/**
 * Sales week used for demand: week before schedule weekStart, else latest week in DB
 * (e.g. CSV upload for a different week).
 */
export async function loadReferenceSalesForSchedule(
  workplaceId: string,
  scheduleWeekStart: string
): Promise<{
  referenceSales: Array<{ date: string; hour: number; salesAmount: number }>;
  salesReferenceWeekStart: string;
  salesReferenceWeekEnd: string;
}> {
  const { weekStart: prevStart, weekEnd: prevEnd } = getPreviousWeekRange(
    new Date(`${scheduleWeekStart}T12:00:00Z`)
  );

  let referenceSales = await querySalesRange(workplaceId, prevStart, prevEnd);
  let salesReferenceWeekStart = prevStart;
  let salesReferenceWeekEnd = prevEnd;

  if (referenceSales.length === 0) {
    const latest = await query<{ max_date: Date | null }>(
      `SELECT MAX(sale_date) AS max_date FROM hourly_sales_data WHERE workplace_id = $1`,
      [workplaceId]
    );
    const maxDate = latest.rows[0]?.max_date;
    if (maxDate) {
      const anchor = getWeekStart(maxDate instanceof Date ? maxDate : new Date(String(maxDate)));
      salesReferenceWeekStart = formatDate(anchor);
      salesReferenceWeekEnd = formatDate(addDays(anchor, 6));
      referenceSales = await querySalesRange(
        workplaceId,
        salesReferenceWeekStart,
        salesReferenceWeekEnd
      );
    }
  }

  return { referenceSales, salesReferenceWeekStart, salesReferenceWeekEnd };
}

export type EnginePayloadBundle = {
  request: EngineGenerateRequest;
  /** Stored in schedules.ml_metadata for transparency */
  context: {
    salesReferenceWeekStart: string;
    salesReferenceWeekEnd: string;
    labourCostPct: number;
    avgHourlyWage: number;
    roleRequirementsConfigured: boolean;
  };
};

export async function buildEnginePayload(
  workplaceId: string,
  weekStart: string
): Promise<EnginePayloadBundle> {
  const wp = await query<{
    preferences: WorkplacePreferences;
    operating_hours: {
      default?: { open: string; close: string };
      byDay?: Record<string, { open: string; close: string; closed?: boolean }>;
    } | null;
  }>(`SELECT preferences, operating_hours FROM workplaces WHERE id = $1`, [workplaceId]);
  if (wp.rows.length === 0) throw httpError(404, "Workplace not found");

  const preferences = wp.rows[0].preferences as WorkplacePreferences;
  const constraints = (preferences.constraints ?? {}) as Record<string, unknown>;
  const roleRequirements = normalizeRoleRequirements(constraints.roleRequirements);

  const operatingHours = {
    default: wp.rows[0].operating_hours?.default ?? { open: "10:00", close: "22:00" },
    byDay: wp.rows[0].operating_hours?.byDay ?? {},
  };

  const { referenceSales, salesReferenceWeekStart, salesReferenceWeekEnd } =
    await loadReferenceSalesForSchedule(workplaceId, weekStart);
  const sales = mapSalesToTargetWeek(referenceSales, weekStart);

  const employees = await query<{
    user_id: string;
    role: string;
    profile_data: Record<string, unknown> | null;
  }>(
    `SELECT ep.user_id, ep.role, ep.profile_data
     FROM employee_profiles ep
     JOIN users u ON u.id = ep.user_id
     WHERE ep.workplace_id = $1`,
    [workplaceId]
  );

  const availability = await query<{
    user_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>(
    `SELECT ea.user_id, ea.day_of_week, ea.start_time::text, ea.end_time::text
     FROM employee_availability ea
     JOIN users u ON u.id = ea.user_id
     WHERE u.workplace_id = $1`,
    [workplaceId]
  );

  const submissions = await query<{ user_id: string; status: string }>(
    `SELECT user_id, status FROM availability_submissions
     WHERE workplace_id = $1 AND week_start = $2`,
    [workplaceId, weekStart]
  );

  const targetAnchor = getWeekStart(new Date(`${weekStart}T12:00:00Z`));
  const targetWeekEnd = formatDate(addDays(targetAnchor, 6));
  const timeOff = await query<{ user_id: string; start_date: Date; end_date: Date }>(
    `SELECT user_id, start_date, end_date FROM time_off_requests
     WHERE workplace_id = $1 AND status = 'approved'
       AND end_date >= $2 AND start_date <= $3`,
    [workplaceId, weekStart, targetWeekEnd]
  );

  const request: EngineGenerateRequest = {
    workplace_id: workplaceId,
    week_start: weekStart,
    sales,
    preferences,
    operating_hours: operatingHours,
    role_requirements: roleRequirements,
    employees: employees.rows.map((e) => {
      const pd = (e.profile_data ?? {}) as Record<string, unknown>;
      const roles = (pd.roles as string[] | undefined)?.length
        ? (pd.roles as string[])
        : [normalizeRole(e.role)];
      return {
        user_id: e.user_id,
        role: e.role,
        roles,
        experience_level: (pd.experienceLevel as string) ?? "Intermediate",
        shift_tier: (pd.shiftTier as string) ?? "Rush-capable",
        min_hours: (pd.minHours as number) ?? undefined,
        max_hours: (pd.maxHours as number) ?? undefined,
        min_shifts_per_week: (pd.minShiftsPerWeek as number) ?? undefined,
        max_shifts_per_week: (pd.maxShiftsPerWeek as number) ?? undefined,
        pairing_always_with: (pd.pairingAlwaysWith as string[]) ?? [],
        pairing_never_with: (pd.pairingNeverWith as string[]) ?? [],
      };
    }),
    availability: availability.rows.map((a) => ({
      user_id: a.user_id,
      day_of_week: a.day_of_week,
      start_time: a.start_time.slice(0, 5),
      end_time: a.end_time.slice(0, 5),
    })),
    approved_time_off: timeOff.rows.map((t) => ({
      user_id: t.user_id,
      start_date:
        t.start_date instanceof Date
          ? t.start_date.toISOString().slice(0, 10)
          : String(t.start_date).slice(0, 10),
      end_date:
        t.end_date instanceof Date
          ? t.end_date.toISOString().slice(0, 10)
          : String(t.end_date).slice(0, 10),
    })),
    availability_submissions: submissions.rows.map((s) => ({
      user_id: s.user_id,
      status: s.status as "pending" | "approved" | "rejected",
    })),
  };

  return {
    request,
    context: {
      salesReferenceWeekStart,
      salesReferenceWeekEnd,
      labourCostPct: preferences.labourCostPct ?? 0.2,
      avgHourlyWage: preferences.avgHourlyWage ?? 18.5,
      roleRequirementsConfigured: Object.keys(roleRequirements).length > 0,
    },
  };
}

export { DAY_NAMES_LOWER };
