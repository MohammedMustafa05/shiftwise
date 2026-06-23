import type { GenerateScheduleResponse } from "@shiftagent/shared";
import { formatDate } from "./dates.js";

/** Store 6412 Milton LSL — 20% labour, $20/hr average wage. */
export const LABOUR_COST_PCT = 0.2;
export const AVG_WAGE = 20;
/** @deprecated use AVG_WAGE — kept for backward-compatible imports */
export const LABOUR_COST_DIVISOR = AVG_WAGE;
export const MIN_WORKERS_NEEDED = 3;
export const MANDATORY_FLOOR = MIN_WORKERS_NEEDED;
/** Max concurrent staff when all role caps are filled (1C + 3P + 3Ca). */
export const MAX_ROLE_STAFF = 7;

/** Default fallback when date-specific hours unavailable. */
export const OPERATING_HOUR_START = 10;
export const OPERATING_HOUR_END = 23;

/** Per-day store hours — dow 0=Monday (Python weekday / spec convention). */
// Monday and Wednesday show $26/$18 in the 10PM–11PM Drop Chart slot — close-down
// stragglers, not active operating hours. Tue/Thu have zero data past 10PM, confirming
// the weeknight pattern is close at 10PM. Friday/Saturday stay open until midnight.
export const OPERATING_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 10, close: 22 }, // Monday    10AM–10PM
  1: { open: 10, close: 22 }, // Tuesday   10AM–10PM
  2: { open: 10, close: 22 }, // Wednesday 10AM–10PM
  3: { open: 10, close: 22 }, // Thursday  10AM–10PM
  4: { open: 10, close: 24 }, // Friday    10AM–12AM
  5: { open: 11, close: 24 }, // Saturday  11AM–12AM
  6: { open: 11, close: 22 }, // Sunday    11AM–10PM
};

export type StaffingRole = "COOK" | "CASHIER" | "PACKLINER";

export const ROLE_CAPS: Record<StaffingRole, number> = {
  COOK: 1,
  CASHIER: 2,
  PACKLINER: 4,
};

const FLOOR_ROLES: Record<StaffingRole, number> = {
  COOK: 1,
  CASHIER: 1,
  PACKLINER: 1,
};

/** Extras count → role breakdown (Pack prioritized; max 2 cashiers). */
const ROLE_DISTRIBUTION: Record<number, Record<StaffingRole, number>> = {
  0: { COOK: 1, PACKLINER: 1, CASHIER: 1 },  // 3 workers
  1: { COOK: 1, PACKLINER: 2, CASHIER: 1 },  // 4 workers
  2: { COOK: 1, PACKLINER: 2, CASHIER: 2 },  // 5 workers
  3: { COOK: 1, PACKLINER: 3, CASHIER: 2 },  // 6 workers
  4: { COOK: 1, PACKLINER: 4, CASHIER: 2 },  // 7 workers
};

/** JS getUTCDay (0=Sun) → spec/Python weekday (0=Mon). */
export function pythonWeekdayFromDate(date: string): number {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

export function operatingHoursForDate(date: string): { open: number; close: number } {
  return OPERATING_HOURS[pythonWeekdayFromDate(date)] ?? {
    open: OPERATING_HOUR_START,
    close: OPERATING_HOUR_END,
  };
}

/**
 * Formula total headcount — never below mandatory floor.
 * Formula: max(3, round((sales × labour %) / avg_wage))
 */
export function formulaHeadcountFromSales(
  salesAmount: number,
  labourCostPct: number = LABOUR_COST_PCT,
  avgWage: number = AVG_WAGE
): number {
  if (salesAmount <= 0) return MANDATORY_FLOOR;
  const raw = Math.round((salesAmount * labourCostPct) / avgWage);
  return Math.max(MANDATORY_FLOOR, raw);
}

export function extraWorkersFromFormula(formulaHeadcount: number): number {
  return Math.max(0, formulaHeadcount - MANDATORY_FLOOR);
}

function rolesForExtras(extras: number): Record<StaffingRole, number> {
  return { ...ROLE_DISTRIBUTION[Math.min(extras, 4)] };
}

export function computeWorkersNeeded(
  hourlySales: number,
  labourCostPct: number = LABOUR_COST_PCT,
  avgWage: number = AVG_WAGE
): {
  total: number;
  effectiveTotal: number;
  cook: number;
  pack: number;
  cash: number;
  extras: number;
  mandatoryFloor: number;
  formulaHeadcount: number;
  overdemand: boolean;
} {
  const formulaHeadcount = formulaHeadcountFromSales(hourlySales, labourCostPct, avgWage);
  const extras = extraWorkersFromFormula(formulaHeadcount);
  const roles = rolesForExtras(extras);
  return {
    total: formulaHeadcount,
    effectiveTotal: Math.min(formulaHeadcount, MAX_ROLE_STAFF),
    cook: roles.COOK,
    pack: roles.PACKLINER,
    cash: roles.CASHIER,
    extras,
    mandatoryFloor: MANDATORY_FLOOR,
    formulaHeadcount,
    overdemand: formulaHeadcount > MAX_ROLE_STAFF,
  };
}

export function floorRoleTargets(): Record<StaffingRole, number> {
  return { ...FLOOR_ROLES };
}

/**
 * Given the current concurrent counts at an hour, return true if the role
 * split is consistent with the ROLE_DISTRIBUTION table.
 *
 * The coupling rule: Cook ≤ Cash ≤ Pack at all times.
 * - Cook is always exactly 1 (never 0, never 2).
 * - Cashier can only reach 2 once Pack is also ≥ 2 (i.e. 5+ workers).
 * - Pack grows first as headcount rises.
 *
 * This is a stronger check than independent ROLE_CAPS: 1C/2Ca/1P is invalid
 * even though 2 ≤ ROLE_CAPS.CASHIER and 1 ≤ ROLE_CAPS.PACKLINER.
 */
export function isValidRoleSplit(
  cook: number,
  cash: number,
  pack: number
): boolean {
  // Cook always exactly 1 when operating
  if (cook !== 1) return false;
  // Cash can only exceed 1 when pack ≥ cash (pack grows first)
  if (cash > pack) return false;
  // Hard caps
  if (cash > ROLE_CAPS.CASHIER) return false;
  if (pack > ROLE_CAPS.PACKLINER) return false;
  return true;
}

/**
 * Given existing role counts and a new role being added, return true if the
 * resulting split would be valid under the coupled ROLE_DISTRIBUTION table.
 */
export function addingRoleIsValid(
  current: Record<StaffingRole, number>,
  adding: StaffingRole
): boolean {
  const next = { ...current, [adding]: current[adding] + 1 };
  return isValidRoleSplit(next.COOK, next.CASHIER, next.PACKLINER);
}

/** Distribute extras: Pack → Cash → Pack → Cash (cook stays at floor=1). */
export function extraRoleTargets(extraWorkers: number): Record<StaffingRole, number> {
  const roles = rolesForExtras(extraWorkers);
  return {
    COOK: 0,
    CASHIER: Math.max(0, roles.CASHIER - FLOOR_ROLES.CASHIER),
    PACKLINER: Math.max(0, roles.PACKLINER - FLOOR_ROLES.PACKLINER),
  };
}

/** Combined floor + extra role targets (capped at max role model). */
export function combinedRoleTargets(formulaHeadcount: number): Record<StaffingRole, number> {
  const extras = extraWorkersFromFormula(formulaHeadcount);
  return rolesForExtras(extras);
}

export function workersNeededFromSales(
  salesAmount: number,
  labourCostPct: number = LABOUR_COST_PCT,
  avgWage: number = AVG_WAGE
): number {
  return formulaHeadcountFromSales(salesAmount, labourCostPct, avgWage);
}

export function roleTargetsForTotalWorkers(totalWorkers: number): Record<StaffingRole, number> {
  return combinedRoleTargets(Math.max(MANDATORY_FLOOR, totalWorkers));
}

export function buildHourlyDemand(
  sales: Array<{ date: string; hour: number; salesAmount: number }>,
  labourCostPct: number = LABOUR_COST_PCT,
  avgWage: number = AVG_WAGE
): GenerateScheduleResponse["workersNeeded"]["byHour"] {
  return sales.map((s) => {
    const result = computeWorkersNeeded(s.salesAmount, labourCostPct, avgWage);
    const extra = result.extras;
    return {
      date: s.date,
      hour: s.hour,
      sales: s.salesAmount,
      mandatoryFloor: MANDATORY_FLOOR,
      formulaHeadcount: result.formulaHeadcount,
      extraWorkers: extra,
      workers: result.formulaHeadcount,
      floorRoles: floorRoleTargets(),
      extraRoles: extraRoleTargets(extra),
      roles: combinedRoleTargets(result.formulaHeadcount),
    };
  });
}

export function buildDailyDemandFromHourly(
  byHour: GenerateScheduleResponse["workersNeeded"]["byHour"],
  labourCostPct: number = LABOUR_COST_PCT,
  avgWage: number = AVG_WAGE
): GenerateScheduleResponse["workersNeeded"]["byDay"] {
  const daySales = new Map<string, number>();
  for (const h of byHour) {
    daySales.set(h.date, (daySales.get(h.date) ?? 0) + h.sales);
  }
  return [...daySales.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sales]) => {
      const formula = formulaHeadcountFromSales(sales, labourCostPct, avgWage);
      return {
        date,
        sales,
        mandatoryFloor: MANDATORY_FLOOR,
        formulaHeadcount: formula,
        extraWorkers: extraWorkersFromFormula(formula),
        workers: formula,
      };
    });
}

/** Remap sales-history dates onto the schedule week (same weekday). */
export function remapSalesDateToScheduleWeek(salesDate: string, scheduleWeekStart: string): string {
  const d = new Date(`${salesDate}T12:00:00Z`);
  const monday = new Date(`${scheduleWeekStart}T12:00:00Z`);
  const offsetFromMonday = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1;
  const target = new Date(monday);
  target.setUTCDate(target.getUTCDate() + offsetFromMonday);
  return formatDate(target);
}

export function remapWorkersNeededToScheduleWeek(
  workersNeeded: GenerateScheduleResponse["workersNeeded"],
  scheduleWeekStart: string
): GenerateScheduleResponse["workersNeeded"] {
  const byHour = workersNeeded.byHour.map((h) => {
    const formula = h.formulaHeadcount ?? h.workers;
    return {
      ...h,
      date: remapSalesDateToScheduleWeek(h.date, scheduleWeekStart),
      mandatoryFloor: h.mandatoryFloor ?? MANDATORY_FLOOR,
      formulaHeadcount: formula,
      extraWorkers: h.extraWorkers ?? extraWorkersFromFormula(formula),
      floorRoles: h.floorRoles ?? floorRoleTargets(),
      extraRoles: h.extraRoles ?? extraRoleTargets(extraWorkersFromFormula(formula)),
      roles: h.roles ?? combinedRoleTargets(formula),
    };
  });
  const byDay = workersNeeded.byDay.map((d) => {
    const formula = d.formulaHeadcount ?? d.workers;
    return {
      ...d,
      date: remapSalesDateToScheduleWeek(d.date, scheduleWeekStart),
      mandatoryFloor: d.mandatoryFloor ?? MANDATORY_FLOOR,
      formulaHeadcount: formula,
      extraWorkers: d.extraWorkers ?? extraWorkersFromFormula(formula),
    };
  });
  return { byHour, byDay };
}

export type HourlyRoleTargets = Record<StaffingRole, number>;

export type WorkersNeededMaps = {
  hourlyCap: Map<string, number>;
  dailyCap: Map<string, number>;
  hourlyFloorRoles: Map<string, HourlyRoleTargets>;
  hourlyExtraRoleTargets: Map<string, HourlyRoleTargets>;
  hourlyRoleTargets: Map<string, HourlyRoleTargets>;
  scheduleDates: string[];
};

/** All seven dates (Mon–Sun) for a schedule week starting Monday. */
export function scheduleWeekDates(weekStart: string): string[] {
  const monday = new Date(`${weekStart}T12:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

export function workersNeededMaps(
  workersNeeded: GenerateScheduleResponse["workersNeeded"],
  weekStart?: string
): WorkersNeededMaps {
  const hourlyCap = new Map<string, number>();
  const hourlyFloorRoles = new Map<string, HourlyRoleTargets>();
  const hourlyExtraRoleTargets = new Map<string, HourlyRoleTargets>();
  const hourlyRoleTargets = new Map<string, HourlyRoleTargets>();

  for (const h of workersNeeded.byHour) {
    const key = `${h.date}|${h.hour}`;
    const formula = h.formulaHeadcount ?? h.workers;
    const effectiveCap = Math.min(formula, MAX_ROLE_STAFF);
    hourlyCap.set(key, effectiveCap);
    hourlyFloorRoles.set(key, h.floorRoles ?? floorRoleTargets());
    hourlyExtraRoleTargets.set(key, h.extraRoles ?? extraRoleTargets(extraWorkersFromFormula(formula)));
    hourlyRoleTargets.set(key, h.roles ?? combinedRoleTargets(formula));
  }

  const dailyCap = new Map<string, number>();
  const dateSet = new Set<string>();
  const dates =
    weekStart && weekStart.length > 0
      ? scheduleWeekDates(weekStart)
      : [...new Set([...workersNeeded.byHour.map((h) => h.date), ...workersNeeded.byDay.map((d) => d.date)])].sort();

  for (const d of dates) dateSet.add(d);
  for (const d of workersNeeded.byDay) {
    dailyCap.set(d.date, Math.min(d.formulaHeadcount ?? d.workers, MAX_ROLE_STAFF));
    dateSet.add(d.date);
  }
  for (const h of workersNeeded.byHour) dateSet.add(h.date);

  // Every operating hour gets floor coverage even when sales data skipped a slot
  for (const date of dateSet) {
    const { open, close } = operatingHoursForDate(date);
    for (let hour = open; hour < close; hour++) {
      const key = `${date}|${hour}`;
      if (!hourlyCap.has(key)) {
        hourlyCap.set(key, MANDATORY_FLOOR);
        hourlyFloorRoles.set(key, floorRoleTargets());
        hourlyExtraRoleTargets.set(key, extraRoleTargets(0));
        hourlyRoleTargets.set(key, combinedRoleTargets(MANDATORY_FLOOR));
      }
    }
  }

  return {
    hourlyCap,
    dailyCap,
    hourlyFloorRoles,
    hourlyExtraRoleTargets,
    hourlyRoleTargets,
    scheduleDates: [...dateSet].sort(),
  };
}

export type RoleOverrideFlag = {
  type: "preference_override";
  date: string;
  hour: number;
  role: StaffingRole;
  formulaCount: number;
  managerCount: number;
  message: string;
};

/**
 * Merge manager-configured role requirements with sales-driven demand.
 * Strategy: MAX(formula, preferences) per role per hour.
 *   - If sales demand ≥ manager preference → formula wins (already cost-justified)
 *   - If manager preference > sales demand → manager wins (they know their restaurant)
 *     and a flag is emitted so the schedule summary shows the cost impact
 *
 * roleRequirements: { monday: [{ from, to, cooks, cashiers, packliners }], ... }
 */
export function applyRoleRequirements(
  demand: WorkersNeededMaps,
  roleRequirements: Record<string, Array<{ from: string; to: string; cooks?: number; cashiers?: number; packliners?: number }>>,
  avgWage: number = AVG_WAGE
): RoleOverrideFlag[] {
  const flags: RoleOverrideFlag[] = [];
  const dayToWeekday: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  console.log("[applyRoleRequirements] Input keys:", Object.keys(roleRequirements));
  console.log("[applyRoleRequirements] Schedule dates:", demand.scheduleDates);

  for (const date of demand.scheduleDates) {
    const jsDay = new Date(`${date}T12:00:00Z`).getUTCDay();
    const dayName = Object.entries(dayToWeekday).find(([, v]) => v === jsDay)?.[0];
    if (!dayName) continue;

    const titleCase = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const bands = roleRequirements[dayName] ?? roleRequirements[titleCase];
    if (!Array.isArray(bands)) {
      console.log(`[applyRoleRequirements] No bands for ${date} (tried "${dayName}" and "${titleCase}")`);
      continue;
    }
    console.log(`[applyRoleRequirements] ${date} (${titleCase}): ${bands.length} bands`);

    for (const band of bands) {
      const fromH = parseInt(band.from?.slice(0, 2) ?? "0", 10);
      const toH = parseInt(band.to?.slice(0, 2) ?? "0", 10) || 24;
      const mins: Record<StaffingRole, number> = {
        COOK: band.cooks ?? 0,
        CASHIER: band.cashiers ?? 0,
        PACKLINER: band.packliners ?? 0,
      };

      for (let hour = fromH; hour < toH; hour++) {
        const key = `${date}|${hour}`;
        let existing = demand.hourlyRoleTargets.get(key);
        if (!existing) {
          existing = combinedRoleTargets(MANDATORY_FLOOR);
          demand.hourlyRoleTargets.set(key, existing);
          demand.hourlyCap.set(key, MANDATORY_FLOOR);
        }

        const updated = { ...existing };
        for (const role of ["COOK", "CASHIER", "PACKLINER"] as StaffingRole[]) {
          if (mins[role] > updated[role]) {
            flags.push({
              type: "preference_override",
              date,
              hour,
              role,
              formulaCount: updated[role],
              managerCount: mins[role],
              message: `Manager requires ${mins[role]} ${role.toLowerCase()}${mins[role] > 1 ? "s" : ""} at ${hour}:00 (sales formula: ${updated[role]}) — +$${avgWage}/hr`,
            });
            updated[role] = mins[role];
          }
        }
        demand.hourlyRoleTargets.set(key, updated);

        const total = updated.COOK + updated.CASHIER + updated.PACKLINER;
        const currentCap = demand.hourlyCap.get(key) ?? MANDATORY_FLOOR;
        if (total > currentCap) {
          demand.hourlyCap.set(key, total);
        }
      }
    }
  }

  console.log(`[applyRoleRequirements] Generated ${flags.length} override flags`);
  return flags;
}

/** Floor-only demand when ML predictions are missing — 1 cook + 1 pack + 1 cash per operating hour. */
export function buildMinimalWorkersNeeded(
  weekStart: string
): GenerateScheduleResponse["workersNeeded"] {
  const dates = scheduleWeekDates(weekStart);
  const byHour: GenerateScheduleResponse["workersNeeded"]["byHour"] = [];
  const byDay: GenerateScheduleResponse["workersNeeded"]["byDay"] = [];

  for (const date of dates) {
    const { open, close } = operatingHoursForDate(date);
    let daySales = 0;
    for (let hour = open; hour < close; hour++) {
      byHour.push({
        date,
        hour,
        sales: 0,
        workers: MANDATORY_FLOOR,
        mandatoryFloor: MANDATORY_FLOOR,
        formulaHeadcount: MANDATORY_FLOOR,
        extraWorkers: 0,
        floorRoles: floorRoleTargets(),
        extraRoles: extraRoleTargets(0),
        roles: combinedRoleTargets(MANDATORY_FLOOR),
      });
    }
    byDay.push({
      date,
      sales: daySales,
      workers: MANDATORY_FLOOR,
      mandatoryFloor: MANDATORY_FLOOR,
      formulaHeadcount: MANDATORY_FLOOR,
      extraWorkers: 0,
    });
  }

  return { byHour, byDay };
}
