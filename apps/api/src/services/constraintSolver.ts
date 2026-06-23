import type {
  GenerateScheduleResponse,
  LLMShiftSuggestion,
  WorkplacePreferences,
} from "@shiftagent/shared";
import { parseTimeToHours } from "../utils/dates.js";
import {
  MIN_WORKERS_NEEDED,
  MANDATORY_FLOOR,
  ROLE_CAPS,
  roleTargetsForTotalWorkers,
  workersNeededMaps,
  applyRoleRequirements,
  type RoleOverrideFlag,
  operatingHoursForDate,
  OPERATING_HOUR_START,
  OPERATING_HOUR_END,
  addingRoleIsValid,
  type HourlyRoleTargets,
  type StaffingRole,
  type WorkersNeededMaps,
} from "../utils/labourDemand.js";
import { hoursCoveredByShift, shiftCoversHour } from "../utils/shiftHours.js";
import { bestShiftWindowForHour } from "./historicalScheduleStyle.js";

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MIN_SHIFT_HOURS = 3;
/** Floor closing shifts may be 2h when they extend to store close. */
const FLOOR_MIN_SHIFT_HOURS = 2;
const MAX_SHIFT_HOURS = 14;
/** Every available employee should work at least this many days per week. */
const DEFAULT_MIN_SHIFTS_PER_WEEK = 2;
/**
 * Maximum hours a single shift may grow to via extension.
 * Prefer assigning a second employee for coverage beyond this point.
 * 10 hours covers a full open-to-close span (e.g. 10:00–20:00) without pushing
 * into unrealistic 12-hour territory; we allow slightly longer on Fri/Sat closing.
 */
const MAX_EXTEND_HOURS = 10;
/** Restaurant default floor hours — use operatingHoursForDate(date) per day when iterating. */
export { OPERATING_HOUR_START, OPERATING_HOUR_END };
/** H3: after this hour (22:00–23:59), minimum 2 distinct people on floor. */
export const LATE_NIGHT_HOUR_START = 22;
export const LATE_NIGHT_MIN_HEADCOUNT = 2;
/** Hard minimum per core role for every operating hour. */
export const CORE_ROLE_MIN = 1;

export type SolverHardFlag = {
  severity: "hard";
  code: "H1_ROLE_COVERAGE_GAP" | "H3_LATE_NIGHT_HEADCOUNT";
  date: string;
  hour: number;
  role?: StaffingRole;
  detail: string;
};

export type ValidatedShift = {
  employeeId: string;
  day: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  role: string;
  location: string;
  isEngineSuggested: boolean;
  llmReasoning: string | null;
};

type BaselineShift = GenerateScheduleResponse["shifts"][number];

type SolverEmployee = {
  user_id: string;
  role: string;
  roles?: string[];
  max_hours?: number;
  min_hours?: number;
  min_shifts?: number;
};

type SolverAvailability = {
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type ApprovedTimeOff = { user_id: string; start_date: string; end_date: string };

function canonicalRole(role: string): string {
  const r = role.trim().toUpperCase();
  if (r === "COOK") return "COOK";
  if (r === "CASHIER" || r === "CASH") return "CASHIER";
  if (r === "PACKLINER" || r === "PACK") return "PACKLINER";
  if (r === "STAFF") return "STAFF";
  return r;
}

function isStaffingRole(role: string): role is StaffingRole {
  return role === "COOK" || role === "CASHIER" || role === "PACKLINER";
}

function dowOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function isOperatingHour(date: string, hour: number): boolean {
  const { open, close } = operatingHoursForDate(date);
  return hour >= open && hour < close;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

/** Treat 00:00 end as midnight when shift/availability starts after noon. */
function effectiveEndMinutes(end: string, start: string): number {
  const e = toMinutes(end);
  const s = toMinutes(start);
  if (e === 0 && s >= 12 * 60) return 24 * 60;
  if (e <= s && s > 0) return e + 24 * 60;
  return e;
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shiftLengthHours(start: string, end: string): number {
  return parseTimeToHours(start, end);
}

function shiftsOverlap(
  existing: ValidatedShift[],
  userId: string,
  date: string,
  start: string,
  end: string
): boolean {
  // Use effectiveEndMinutes so "00:00" midnight end is treated as 24:00, not 0.
  const s = toMinutes(start);
  const e = effectiveEndMinutes(end, start);
  return existing
    .filter((sh) => sh.employeeId === userId && sh.shiftDate === date)
    .some((sh) => {
      const a = toMinutes(sh.startTime);
      const b = effectiveEndMinutes(sh.endTime, sh.startTime);
      return s < b && e > a;
    });
}

function concurrentWorkersAtHour(
  shifts: ValidatedShift[],
  date: string,
  hour: number
): Set<string> {
  const ids = new Set<string>();
  for (const sh of shifts) {
    if (sh.shiftDate !== date) continue;
    if (shiftCoversHour(sh.startTime, sh.endTime, hour)) ids.add(sh.employeeId);
  }
  return ids;
}

function concurrentRoleCounts(
  shifts: ValidatedShift[],
  date: string,
  hour: number
): Record<StaffingRole, number> {
  const counts: Record<StaffingRole, number> = { COOK: 0, CASHIER: 0, PACKLINER: 0 };
  for (const sh of shifts) {
    if (sh.shiftDate !== date || !shiftCoversHour(sh.startTime, sh.endTime, hour)) continue;
    const r = canonicalRole(sh.role);
    if (isStaffingRole(r)) counts[r]++;
  }
  return counts;
}

function uniqueWorkersOnDay(shifts: ValidatedShift[], date: string): Set<string> {
  const ids = new Set<string>();
  for (const sh of shifts) {
    if (sh.shiftDate === date) ids.add(sh.employeeId);
  }
  return ids;
}

/** Map of employeeId → set of staffing roles they already work on `date`. */
function rolesWorkedOnDate(
  shifts: ValidatedShift[],
  date: string
): Map<string, Set<StaffingRole>> {
  const map = new Map<string, Set<StaffingRole>>();
  for (const sh of shifts) {
    if (sh.shiftDate !== date) continue;
    const r = canonicalRole(sh.role);
    if (!isStaffingRole(r)) continue;
    if (!map.has(sh.employeeId)) map.set(sh.employeeId, new Set());
    map.get(sh.employeeId)!.add(r);
  }
  return map;
}

/**
 * Coalesce contiguous (or overlapping) same-employee / same-day / same-role
 * shifts into a single shift.  The solver builds coverage hour-by-hour, which
 * can leave a person with e.g. 10:00–17:00 + 17:00–22:00 of the same role —
 * really one 10:00–22:00 shift.  Merging removes that fragmentation without
 * changing any hour's coverage.  Combined shifts longer than MAX_SHIFT_HOURS
 * are left split.  Returns the number of shifts removed by merging.
 */
function mergeContiguousShifts(accepted: ValidatedShift[]): number {
  const groups = new Map<string, ValidatedShift[]>();
  for (const sh of accepted) {
    const key = `${sh.employeeId}|${sh.shiftDate}|${canonicalRole(sh.role)}`;
    const list = groups.get(key) ?? [];
    list.push(sh);
    groups.set(key, list);
  }

  const merged: ValidatedShift[] = [];
  let removed = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    let cur = group[0];
    for (let i = 1; i < group.length; i++) {
      const next = group[i];
      const curEnd = effectiveEndMinutes(cur.endTime, cur.startTime);
      const nextStart = toMinutes(next.startTime);
      const nextEnd = effectiveEndMinutes(next.endTime, next.startTime);
      const combinedLen = Math.max(curEnd, nextEnd) - toMinutes(cur.startTime);
      if (nextStart <= curEnd && combinedLen <= MAX_SHIFT_HOURS * 60) {
        // Contiguous/overlapping and within max length → extend cur to the later end.
        if (nextEnd > curEnd) cur = { ...cur, endTime: next.endTime };
        removed++;
      } else {
        merged.push(cur);
        cur = next;
      }
    }
    merged.push(cur);
  }

  accepted.splice(0, accepted.length, ...merged);
  return removed;
}

function roleTargetsForHour(
  demand: WorkersNeededMaps,
  date: string,
  hour: number
): HourlyRoleTargets {
  const key = `${date}|${hour}`;
  return demand.hourlyRoleTargets.get(key) ?? roleTargetsForTotalWorkers(MANDATORY_FLOOR);
}

function requiredRoleCountAtHour(
  demand: WorkersNeededMaps,
  date: string,
  hour: number,
  role: StaffingRole,
  phase: "floor" | "demand"
): number {
  const targets = roleTargetsForHour(demand, date, hour);
  if (phase === "floor") {
    // Floor guarantees manager-specified minimums (which are already
    // merged into targets via applyRoleRequirements). This ensures
    // "2 cooks at lunch" is treated as mandatory, not optional.
    return Math.max(CORE_ROLE_MIN, targets[role]);
  }
  return Math.max(CORE_ROLE_MIN, targets[role]);
}

function employeeRoles(emp: SolverEmployee): Set<string> {
  const roles = emp.roles?.length ? emp.roles : [emp.role];
  return new Set(roles.map(canonicalRole));
}

function rolesUnionAtHour(
  shifts: ValidatedShift[],
  empById: Map<string, SolverEmployee>,
  date: string,
  hour: number
): { headcount: number; roles: Set<StaffingRole> } {
  const workers = concurrentWorkersAtHour(shifts, date, hour);
  const roles = new Set<StaffingRole>();
  for (const uid of workers) {
    const emp = empById.get(uid);
    if (!emp) continue;
    for (const r of employeeRoles(emp)) {
      if (isStaffingRole(r)) roles.add(r);
    }
  }
  return { headcount: workers.size, roles };
}

/** H3 unmet: fewer than 2 people OR combined qualifications missing a core role. */
function lateNightRuleUnmet(
  shifts: ValidatedShift[],
  empById: Map<string, SolverEmployee>,
  date: string,
  hour: number
): boolean {
  const { headcount, roles } = rolesUnionAtHour(shifts, empById, date, hour);
  if (headcount === 0) return false;
  if (headcount < LATE_NIGHT_MIN_HEADCOUNT) return true;
  return (
    !roles.has("COOK") || !roles.has("CASHIER") || !roles.has("PACKLINER")
  );
}

/** Hours >= 22 that any shift on `date` covers (late-night window). */
function lateNightHoursOnDate(shifts: ValidatedShift[], date: string): number[] {
  const hours = new Set<number>();
  for (const sh of shifts) {
    if (sh.shiftDate !== date) continue;
    for (const h of hoursCoveredByShift(sh.startTime, sh.endTime)) {
      if (h >= LATE_NIGHT_HOUR_START) hours.add(h);
    }
  }
  return [...hours].sort((a, b) => a - b);
}

function hourHasCoreDeficit(shifts: ValidatedShift[], date: string, hour: number): boolean {
  const c = concurrentRoleCounts(shifts, date, hour);
  return (
    c.COOK < CORE_ROLE_MIN || c.CASHIER < CORE_ROLE_MIN || c.PACKLINER < CORE_ROLE_MIN
  );
}

/** Can remove this shift without breaking floor role mix (1+1+1) or H3 late-night rules. */
function removableWithoutBreakingFloor(
  shifts: ValidatedShift[],
  removeIdx: number,
  empById: Map<string, SolverEmployee>
): boolean {
  const sh = shifts[removeIdx];
  const trial = shifts.filter((_, i) => i !== removeIdx);
  for (const hour of hoursCoveredByShift(sh.startTime, sh.endTime)) {
    if (isOperatingHour(sh.shiftDate, hour)) {
      if (hourHasCoreDeficit(trial, sh.shiftDate, hour)) return false;
    }
    if (hour >= LATE_NIGHT_HOUR_START) {
      const hadCoverage = concurrentWorkersAtHour(shifts, sh.shiftDate, hour).size > 0;
      if (hadCoverage && lateNightRuleUnmet(trial, empById, sh.shiftDate, hour)) return false;
    }
  }
  return true;
}

function exceedsRoleCapAtAnyHour(
  shifts: ValidatedShift[],
  candidate: { date: string; start_time: string; end_time: string; role: string },
  demand?: WorkersNeededMaps
): boolean {
  const role = canonicalRole(candidate.role);
  if (!isStaffingRole(role)) return false;
  for (const hour of hoursCoveredByShift(candidate.start_time, candidate.end_time)) {
    if (!isOperatingHour(candidate.date, hour)) continue;
    const counts = concurrentRoleCounts(shifts, candidate.date, hour);
    const effectiveCap = demand
      ? Math.max(ROLE_CAPS[role], roleTargetsForHour(demand, candidate.date, hour)[role])
      : ROLE_CAPS[role];
    if (counts[role] >= effectiveCap) return true;
  }
  return false;
}

/**
 * Demand-phase only: a shift may not push a role above its per-hour TARGET from
 * the workers-needed table (e.g. 4 workers ⇒ 1C/2P/1Ca — a second cashier is
 * rejected even though the hard ROLE_CAP for cashiers is 2).  Operating hours
 * where the role is at/over target at ANY covered hour reject the shift; the
 * demandWindow clipping keeps shifts inside the under-target span so legit
 * shifts are not blocked by slow shoulder hours.
 */
function exceedsRoleTargetAtAnyHour(
  shifts: ValidatedShift[],
  candidate: { date: string; start_time: string; end_time: string; role: string },
  demand: WorkersNeededMaps
): boolean {
  const role = canonicalRole(candidate.role);
  if (!isStaffingRole(role)) return false;
  for (const hour of hoursCoveredByShift(candidate.start_time, candidate.end_time)) {
    if (!isOperatingHour(candidate.date, hour)) continue;
    const counts = concurrentRoleCounts(shifts, candidate.date, hour);
    const target = requiredRoleCountAtHour(demand, candidate.date, hour, role, "demand");
    if (counts[role] >= target) return true;
  }
  return false;
}

/** Headcount caps apply; core trio can bypass when filling gaps. */
function exceedsLabourCap(
  accepted: ValidatedShift[],
  candidate: { employee_id: string; date: string; start_time: string; end_time: string; role?: string },
  demand: WorkersNeededMaps,
  options?: { coreFillOnly?: boolean }
): boolean {
  if (options?.coreFillOnly) {
    // Floor phase: role composition caps do not apply — personal max hours checked at assignment site.
    return false;
  }

  const role = candidate.role ? canonicalRole(candidate.role) : null;

  if (exceedsRoleCapAtAnyHour(accepted, {
    date: candidate.date,
    start_time: candidate.start_time,
    end_time: candidate.end_time,
    role: candidate.role ?? "STAFF",
  }, demand)) {
    return true;
  }

  const coveredHours = hoursCoveredByShift(candidate.start_time, candidate.end_time);

  const dayCap = demand.dailyCap.get(candidate.date);
  if (dayCap !== undefined) {
    const onDay = uniqueWorkersOnDay(accepted, candidate.date);
    if (!onDay.has(candidate.employee_id) && onDay.size >= dayCap) {
      const wouldFixCore = coveredHours.some(
        (hour) => hourHasCoreDeficit(accepted, candidate.date, hour)
      );
      if (!wouldFixCore) return true;
    }
  }

  // Shift-window awareness: workers can't be sent home mid-shift, so a shift must be
  // treated as one atomic unit. If this employee reduces a headcount deficit at ANY hour
  // they cover, allow the shift — don't block it because OTHER hours in the same shift
  // window happen to be at their (lower) individual cap.
  // Example: a 10-17 shift needed for the 1 PM rush must not be blocked at 10 AM just
  // because that slow early hour already has its 3-person floor cap met.
  const usefulAtSomeHour = coveredHours.some((hour) => {
    const key = `${candidate.date}|${hour}`;
    const hourCap = demand.hourlyCap.get(key) ?? MIN_WORKERS_NEEDED;
    const working = concurrentWorkersAtHour(accepted, candidate.date, hour);
    return !working.has(candidate.employee_id) && working.size < hourCap;
  });

  // If useful anywhere in the shift window, role composition caps are the only hard limit.
  if (usefulAtSomeHour) return false;

  // Not needed at any covered hour — apply strict per-hour checks before allowing.
  for (const hour of coveredHours) {
    const counts = concurrentRoleCounts(accepted, candidate.date, hour);
    const key = `${candidate.date}|${hour}`;
    const hourCap = demand.hourlyCap.get(key) ?? MIN_WORKERS_NEEDED;
    const working = concurrentWorkersAtHour(accepted, candidate.date, hour);
    const roleNeeded =
      role &&
      isStaffingRole(role) &&
      counts[role] < requiredRoleCountAtHour(demand, candidate.date, hour, role, "demand");
    const coreNeeded = hourHasCoreDeficit(accepted, candidate.date, hour);

    if (!working.has(candidate.employee_id) && working.size >= hourCap) {
      if (!(roleNeeded && coreNeeded)) return true;
    }
  }

  return false;
}

/**
 * Find the contiguous span of hours starting at `startHour` where `role` is
 * still under the required demand target.  The returned window is at least
 * MIN_SHIFT_HOURS wide so the resulting shift is schedulable.
 *
 * Used exclusively by the demand phase to produce targeted short shifts
 * (e.g. 18:00–21:00) rather than full half-day blocks (10:00–17:00).
 */
function contiguousDemandSpan(
  date: string,
  startHour: number,
  role: StaffingRole,
  accepted: ValidatedShift[],
  demand: WorkersNeededMaps
): { open: number; close: number } {
  const { open: opOpen, close: opClose } = operatingHoursForDate(date);

  // Expand end-hour while role is still under-required at consecutive hours.
  let endHour = startHour + 1;
  while (endHour < opClose) {
    const required = requiredRoleCountAtHour(demand, date, endHour, role, "demand");
    const current = concurrentRoleCounts(accepted, date, endHour)[role];
    if (current >= required) break;
    endHour++;
  }

  // Guarantee minimum shift length — extend end first, then pull start back.
  endHour = Math.min(Math.max(endHour, startHour + MIN_SHIFT_HOURS), opClose);
  const adjStart = Math.max(opOpen, endHour - Math.max(endHour - startHour, MIN_SHIFT_HOURS));

  return { open: adjStart, close: endHour };
}

function bestOperatingShiftWindow(
  availStart: string,
  availEnd: string,
  mustIncludeHour?: number,
  date?: string,
  options?: { floorPhase?: boolean; demandWindow?: { open: number; close: number } }
): { start: string; end: string } | null {
  const { open, close } = date ? operatingHoursForDate(date) : { open: OPERATING_HOUR_START, close: OPERATING_HOUR_END };
  const opStart = open * 60;
  const opEnd = close * 60;
  const isClosingShift = Math.min(effectiveEndMinutes(availEnd, availStart), opEnd) >= opEnd;
  const effectiveMin =
    options?.floorPhase && isClosingShift ? FLOOR_MIN_SHIFT_HOURS : MIN_SHIFT_HOURS;

  // Demand phase with a targeted window: clip availability to the demand span and
  // return a short shift covering only those hours.  Skip historical block templates
  // entirely — extras should not get full open/close blocks.
  if (options?.demandWindow && !options?.floorPhase) {
    const dwS = options.demandWindow.open * 60;
    const dwE = options.demandWindow.close * 60;
    const aS = Math.max(toMinutes(availStart), opStart, dwS);
    const aE = Math.min(effectiveEndMinutes(availEnd, availStart), opEnd, dwE);
    if (aE - aS < effectiveMin * 60) return null;
    if (mustIncludeHour !== undefined) {
      const hStart = mustIncludeHour * 60;
      if (hStart < aS || hStart + 60 > aE) return null;
    }
    return { start: fromMinutes(aS), end: fromMinutes(aE) };
  }

  const aS = Math.max(toMinutes(availStart), opStart);
  const aE = Math.min(effectiveEndMinutes(availEnd, availStart), opEnd);

  if (mustIncludeHour !== undefined) {
    const styled = bestShiftWindowForHour(availStart, availEnd, mustIncludeHour, date);
    if (styled) {
      const len = shiftLengthHours(styled.start, styled.end);
      // Verify the styled window actually covers the target hour before using it.
      const styleCoversHour =
        toMinutes(styled.start) <= mustIncludeHour * 60 &&
        effectiveEndMinutes(styled.end, styled.start) > mustIncludeHour * 60;
      if (len >= effectiveMin && len <= 14 && styleCoversHour) return styled;
    }
  }
  if (mustIncludeHour !== undefined) {
    const hStart = mustIncludeHour * 60;
    const hEnd = hStart + 60;
    if (hStart < aS || hEnd > aE) return null;
  }
  if (aE - aS < effectiveMin * 60) return null;
  return { start: fromMinutes(aS), end: fromMinutes(aE) };
}

function tryExtendShiftForHour(
  accepted: ValidatedShift[],
  date: string,
  hour: number,
  role: StaffingRole,
  availByUser: Map<string, SolverAvailability[]>,
  dow: number,
  demand: WorkersNeededMaps,
  maxHoursFor: (emp: SolverEmployee) => number,
  empById: Map<string, SolverEmployee>,
  coreFillOnly: boolean
): boolean {
  for (const sh of accepted) {
    if (sh.shiftDate !== date || canonicalRole(sh.role) !== role) continue;
    if (shiftCoversHour(sh.startTime, sh.endTime, hour)) continue;

    const emp = empById.get(sh.employeeId);
    const block = (availByUser.get(sh.employeeId) ?? []).find((b) => b.day_of_week === dow);
    if (!block) continue;

    const { close: opClose } = operatingHoursForDate(date);
    const availEnd = Math.min(effectiveEndMinutes(block.end_time, block.start_time), opClose * 60);
    if (availEnd <= toMinutes(sh.endTime)) continue;

    // Prefer capped end (MAX_EXTEND_HOURS). Override cap only when we reach this code,
    // meaning tryAssignCoverageShift has already failed — i.e. there is no fresh employee
    // to assign. In that case, extending past the cap is unavoidable to fill the gap.
    const cappedEnd = Math.min(availEnd, toMinutes(sh.startTime) + MAX_EXTEND_HOURS * 60);
    const minNeededEnd = (hour + 1) * 60;
    const targetEnd = Math.min(availEnd, Math.max(minNeededEnd, cappedEnd));
    if (targetEnd <= toMinutes(sh.endTime)) continue;

    const newEnd = fromMinutes(targetEnd);
    const newHours = shiftLengthHours(sh.startTime, newEnd);
    if (emp && newHours > maxHoursFor(emp)) continue;

    if (
      exceedsLabourCap(
        accepted.filter((x) => x !== sh),
        {
          employee_id: sh.employeeId,
          date,
          start_time: sh.startTime,
          end_time: newEnd,
          role,
        },
        demand,
        { coreFillOnly }
      )
    ) {
      continue;
    }

    // Demand extensions: the newly added hours must not push the role above its
    // per-hour target from the workers-needed table.
    if (
      !coreFillOnly &&
      exceedsRoleTargetAtAnyHour(
        accepted.filter((x) => x !== sh),
        { date, start_time: sh.endTime, end_time: newEnd, role },
        demand
      )
    ) {
      continue;
    }

    sh.endTime = newEnd;
    return true;
  }
  return false;
}

function tryAssignCoverageShift(
  accepted: ValidatedShift[],
  hoursByUser: Map<string, number>,
  acceptedSlotKeys: Set<string>,
  emp: SolverEmployee,
  date: string,
  dow: number,
  role: StaffingRole,
  hour: number,
  blocks: SolverAvailability[],
  demand: WorkersNeededMaps,
  maxHoursFor: (emp: SolverEmployee) => number,
  isWithinAvailability: (userId: string, date: string, start: string, end: string) => boolean,
  hasTimeOff: (userId: string, date: string) => boolean,
  coreFillOnly: boolean,
  demandWindow?: { open: number; close: number }
): boolean {
  if (hasTimeOff(emp.user_id, date)) return false;

  for (const block of blocks) {
    const win = bestOperatingShiftWindow(block.start_time, block.end_time, hour, date, {
      floorPhase: coreFillOnly,
      demandWindow: coreFillOnly ? undefined : demandWindow,
    });
    if (!win) continue;
    if (!isWithinAvailability(emp.user_id, date, win.start, win.end)) continue;
    if (shiftsOverlap(accepted, emp.user_id, date, win.start, win.end)) continue;

    const shiftHours = shiftLengthHours(win.start, win.end);
    const total = (hoursByUser.get(emp.user_id) ?? 0) + shiftHours;
    if (total > maxHoursFor(emp)) continue;

    const slotKey = `${emp.user_id}|${date}|${win.start}|${role}`;
    if (acceptedSlotKeys.has(slotKey)) continue;

    if (
      exceedsLabourCap(
        accepted,
        {
          employee_id: emp.user_id,
          date,
          start_time: win.start,
          end_time: win.end,
          role,
        },
        demand,
        { coreFillOnly }
      )
    ) {
      continue;
    }

    // Demand extras must respect the per-hour role split from the workers-needed
    // table (e.g. 4 workers ⇒ 1C/2P/1Ca) at every hour they cover — not just the
    // hard ROLE_CAPS maximums (1C/2Ca/4P).
    if (
      !coreFillOnly &&
      exceedsRoleTargetAtAnyHour(
        accepted,
        { date, start_time: win.start, end_time: win.end, role },
        demand
      )
    ) {
      continue;
    }

    hoursByUser.set(emp.user_id, total);
    acceptedSlotKeys.add(slotKey);
    accepted.push({
      employeeId: emp.user_id,
      day: DAY_NAMES[dow] ?? "MON",
      shiftDate: date,
      startTime: win.start,
      endTime: win.end,
      role,
      location: "Main",
      isEngineSuggested: true,
      llmReasoning: coreFillOnly ? "Solver: floor 1+1+1 coverage" : "Solver: demand extra coverage",
    });
    return true;
  }
  return false;
}

/** Collect rejection reasons when floor fill cannot assign a candidate. */
function diagnoseCoverageRejections(
  accepted: ValidatedShift[],
  hoursByUser: Map<string, number>,
  acceptedSlotKeys: Set<string>,
  emp: SolverEmployee,
  date: string,
  dow: number,
  role: StaffingRole,
  hour: number,
  blocks: SolverAvailability[],
  demand: WorkersNeededMaps,
  maxHoursFor: (emp: SolverEmployee) => number,
  isWithinAvailability: (userId: string, date: string, start: string, end: string) => boolean,
  hasTimeOff: (userId: string, date: string) => boolean,
  coreFillOnly: boolean,
  demandWindow?: { open: number; close: number }
): string[] {
  const reasons: string[] = [];
  if (blocks.length === 0) {
    reasons.push(`${emp.user_id}: no availability blocks for DOW ${dow}`);
    return reasons;
  }
  if (hasTimeOff(emp.user_id, date)) {
    reasons.push(`${emp.user_id}: time off`);
    return reasons;
  }

  let anyWindow = false;
  for (const block of blocks) {
    const win = bestOperatingShiftWindow(block.start_time, block.end_time, hour, date, {
      floorPhase: coreFillOnly,
      demandWindow: coreFillOnly ? undefined : demandWindow,
    });
    if (!win) {
      reasons.push(
        `${emp.user_id}: no valid window (avail < ${coreFillOnly ? FLOOR_MIN_SHIFT_HOURS : MIN_SHIFT_HOURS}h or outside operating hours)`
      );
      continue;
    }
    anyWindow = true;
    if (!isWithinAvailability(emp.user_id, date, win.start, win.end)) {
      reasons.push(`${emp.user_id}: shift ${win.start}-${win.end} outside availability`);
      continue;
    }
    if (shiftsOverlap(accepted, emp.user_id, date, win.start, win.end)) {
      reasons.push(`${emp.user_id}: already has shift this day`);
      continue;
    }
    const shiftHours = shiftLengthHours(win.start, win.end);
    const total = (hoursByUser.get(emp.user_id) ?? 0) + shiftHours;
    if (total > maxHoursFor(emp)) {
      reasons.push(`${emp.user_id}: would exceed max hours (${total}h > ${maxHoursFor(emp)}h)`);
      continue;
    }
    const slotKey = `${emp.user_id}|${date}|${win.start}|${role}`;
    if (acceptedSlotKeys.has(slotKey)) {
      reasons.push(`${emp.user_id}: duplicate slot`);
      continue;
    }
    if (
      exceedsLabourCap(
        accepted,
        {
          employee_id: emp.user_id,
          date,
          start_time: win.start,
          end_time: win.end,
          role,
        },
        demand,
        { coreFillOnly }
      )
    ) {
      reasons.push(`${emp.user_id}: labour cap exceeded`);
      continue;
    }
    reasons.push(`${emp.user_id}: unknown rejection`);
  }
  if (!anyWindow && reasons.length === 0) {
    reasons.push(`${emp.user_id}: no valid window`);
  }
  return reasons;
}

/** Remove shifts that over-staff hours without breaking floor role composition (not headcount alone). */
function pruneOverScheduling(
  accepted: ValidatedShift[],
  demand: WorkersNeededMaps,
  empById: Map<string, SolverEmployee>
): number {
  let removed = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const removalScores: Array<{ idx: number; score: number }> = [];

    for (let i = 0; i < accepted.length; i++) {
      const sh = accepted[i];
      let score = 0;
      for (const hour of hoursCoveredByShift(sh.startTime, sh.endTime)) {
        if (hour < LATE_NIGHT_HOUR_START && !isOperatingHour(sh.shiftDate, hour)) continue;
        if (isOperatingHour(sh.shiftDate, hour)) {
          const counts = concurrentRoleCounts(accepted, sh.shiftDate, hour);
          const role = canonicalRole(sh.role);
          if (!isStaffingRole(role)) continue;
          const targets = roleTargetsForHour(demand, sh.shiftDate, hour);
          const hourCap = demand.hourlyCap.get(`${sh.shiftDate}|${hour}`) ?? MIN_WORKERS_NEEDED;
          const headcount = concurrentWorkersAtHour(accepted, sh.shiftDate, hour).size;
          if (counts[role] > targets[role]) score += 10;
          if (counts[role] > ROLE_CAPS[role]) score += 20;
          if (headcount > hourCap) score += 5;
          // Coupled violation: Cash > Pack or any other Cook≤Cash≤Pack breach — highest priority.
          if (!addingRoleIsValid({ ...counts, [role]: counts[role] - 1 }, role)) score += 30;
        }
      }
      // Only remove if floor 1+1+1 (and H3 where applicable) still holds — never prune on headcount alone.
      if (score > 0 && removableWithoutBreakingFloor(accepted, i, empById)) {
        removalScores.push({
          idx: i,
          score: score + (sh.isEngineSuggested ? 1 : 0) + shiftLengthHours(sh.startTime, sh.endTime) * 0.01,
        });
      }
    }

    removalScores.sort((a, b) => b.score - a.score);
    if (removalScores.length > 0) {
      accepted.splice(removalScores[0].idx, 1);
      removed++;
      changed = true;
    }
  }

  return removed;
}

function fillRoleGaps(params: {
  accepted: ValidatedShift[];
  hoursByUser: Map<string, number>;
  acceptedSlotKeys: Set<string>;
  employees: SolverEmployee[];
  empById: Map<string, SolverEmployee>;
  availByUser: Map<string, SolverAvailability[]>;
  demand: WorkersNeededMaps;
  maxHoursFor: (emp: SolverEmployee) => number;
  isWithinAvailability: (userId: string, date: string, start: string, end: string) => boolean;
  hasTimeOff: (userId: string, date: string) => boolean;
  roleMatches: (emp: SolverEmployee, role: string) => boolean;
  phase: "floor" | "demand";
}): number {
  const {
    accepted,
    hoursByUser,
    acceptedSlotKeys,
    employees,
    empById,
    availByUser,
    demand,
    maxHoursFor,
    isWithinAvailability,
    hasTimeOff,
    roleMatches,
    phase,
  } = params;

  const coreFillOnly = phase === "floor";
  let filled = 0;
  const fillOrder: StaffingRole[] = ["COOK", "CASHIER", "PACKLINER"];
  // Track how many shifts (days) each employee has been assigned to penalise heavy users.
  const shiftsByUser = new Map<string, number>();
  for (const sh of accepted) {
    shiftsByUser.set(sh.employeeId, (shiftsByUser.get(sh.employeeId) ?? 0) + 1);
  }

  for (const date of demand.scheduleDates) {
    const dow = dowOf(date);
    const { open, close } = operatingHoursForDate(date);
    for (let hour = open; hour < close; hour++) {
      for (const role of fillOrder) {
        const required = requiredRoleCountAtHour(demand, date, hour, role, phase);
        let guard = 0;
        while (concurrentRoleCounts(accepted, date, hour)[role] < required && guard < 32) {
          guard++;
          const rejections: string[] = [];
          const workingNow = concurrentWorkersAtHour(accepted, date, hour);
          // Roles each employee already works on THIS day — used to keep people in
          // one role across the day (role-stickiness) instead of switching mid-shift.
          const rolesWorkedToday = rolesWorkedOnDate(accepted, date);
          const switchesRole = (uid: string): boolean => {
            const worked = rolesWorkedToday.get(uid);
            if (!worked || worked.size === 0) return false; // not working today → no switch
            return !(worked.size === 1 && worked.has(role)); // works a different role today
          };
          const belowMinShifts = (e: SolverEmployee): boolean =>
            (shiftsByUser.get(e.user_id) ?? 0) < (e.min_shifts ?? 0);
          const candidates = employees
            .filter((e) => roleMatches(e, role))
            .sort((a, b) => {
              // 1. Role-stickiness: avoid pulling in someone already doing a DIFFERENT
              //    role today (prevents Cook→Packliner style mid-day switches).
              const aSwitch = switchesRole(a.user_id) ? 1 : 0;
              const bSwitch = switchesRole(b.user_id) ? 1 : 0;
              if (aSwitch !== bSwitch) return aSwitch - bSwitch;
              // 2. Fairness floor: employees below their minimum weekly shifts first.
              const aBelow = belowMinShifts(a) ? 0 : 1;
              const bBelow = belowMinShifts(b) ? 0 : 1;
              if (aBelow !== bBelow) return aBelow - bBelow;
              // 3. Prefer FRESH employees (not already on the clock this hour) so a new
              //    shift can be opened without overlapping an existing one.
              const aWorking = workingNow.has(a.user_id) ? 1 : 0;
              const bWorking = workingNow.has(b.user_id) ? 1 : 0;
              if (aWorking !== bWorking) return aWorking - bWorking;
              // 4. Prefer employees whose PRIMARY role matches (avoid multi-role mixing)
              const aPrimary = canonicalRole(a.role) === canonicalRole(role) ? 0 : 1;
              const bPrimary = canonicalRole(b.role) === canonicalRole(role) ? 0 : 1;
              if (aPrimary !== bPrimary) return aPrimary - bPrimary;
              // 5. Fairness: prefer employees with fewer shifts this week (spread work evenly)
              const aShifts = shiftsByUser.get(a.user_id) ?? 0;
              const bShifts = shiftsByUser.get(b.user_id) ?? 0;
              if (aShifts !== bShifts) return aShifts - bShifts;
              // 6. Hours worked this week as tiebreaker
              return (hoursByUser.get(a.user_id) ?? 0) - (hoursByUser.get(b.user_id) ?? 0);
            });

          let assigned = false;

          // For demand phase: compute a targeted short shift window covering the
          // contiguous demand peak around this hour.  Floor phase uses full blocks.
          const demandWindow = !coreFillOnly
            ? contiguousDemandSpan(date, hour, role, accepted, demand)
            : undefined;

          // Prefer assigning a fresh employee over extending an existing shift.
          // Extension is a fallback used only when no eligible candidate is available,
          // which prevents single employees from accumulating 12-hour shifts.
          for (const emp of candidates) {
            const blocks = (availByUser.get(emp.user_id) ?? []).filter((b) => b.day_of_week === dow);
            if (
              tryAssignCoverageShift(
                accepted,
                hoursByUser,
                acceptedSlotKeys,
                emp,
                date,
                dow,
                role,
                hour,
                blocks,
                demand,
                maxHoursFor,
                isWithinAvailability,
                hasTimeOff,
                coreFillOnly,
                demandWindow
              )
            ) {
              filled++;
              assigned = true;
              // Update shift-count so subsequent gap sorts reflect the new assignment.
              shiftsByUser.set(emp.user_id, (shiftsByUser.get(emp.user_id) ?? 0) + 1);
              break;
            }
            if (phase === "floor") {
              rejections.push(
                ...diagnoseCoverageRejections(
                  accepted,
                  hoursByUser,
                  acceptedSlotKeys,
                  emp,
                  date,
                  dow,
                  role,
                  hour,
                  blocks,
                  demand,
                  maxHoursFor,
                  isWithinAvailability,
                  hasTimeOff,
                  coreFillOnly,
                  demandWindow
                )
              );
            }
          }
          // Fallback: extend an already-assigned shift when no new employee is available.
          if (!assigned) {
            if (
              tryExtendShiftForHour(
                accepted,
                date,
                hour,
                role,
                availByUser,
                dow,
                demand,
                maxHoursFor,
                empById,
                coreFillOnly
              )
            ) {
              filled++;
              assigned = true;
            }
          }

          if (!assigned) {
            if (phase === "floor") {
              const roleCount = concurrentRoleCounts(accepted, date, hour)[role];
              console.warn(
                `[FloorEngine] FLOOR GAP: ${date} hour=${hour} role=${role} ` +
                  `current=${roleCount} required=${required} ` +
                  `candidates_checked=${candidates.length} ` +
                  `reason=no_eligible_employee_could_be_assigned`
              );
              if (rejections.length > 0) {
                console.warn(
                  `[FloorEngine] FLOOR GAP ${date} ${String(hour).padStart(2, "0")}:00 ${role}\n` +
                    rejections.map((r) => `  - ${r}`).join("\n")
                );
              }
            }
            break;
          }
        }
      }
    }
  }

  return filled;
}

/** Hard flags for unfilled mandatory floor slots (H1) after floor engine passes. */
export function auditFloorHardFlags(
  shifts: ValidatedShift[],
  scheduleDates: string[]
): SolverHardFlag[] {
  const flags: SolverHardFlag[] = [];
  for (const date of scheduleDates) {
    const { open, close } = operatingHoursForDate(date);
    for (let hour = open; hour < close; hour++) {
      const c = concurrentRoleCounts(shifts, date, hour);
      for (const role of ["COOK", "CASHIER", "PACKLINER"] as StaffingRole[]) {
        if (c[role] < CORE_ROLE_MIN) {
          flags.push({
            severity: "hard",
            code: "H1_ROLE_COVERAGE_GAP",
            date,
            hour,
            role,
            detail: `No eligible ${role} available for ${date} ${String(hour).padStart(2, "0")}:00. Cannot meet mandatory floor coverage.`,
          });
        }
      }
    }
  }
  return flags;
}

/** Hard flags for H3 late-night headcount (min 2 people; roles union must cover trio). */
export function auditLateNightHardFlags(
  shifts: ValidatedShift[],
  scheduleDates: string[],
  empById: Map<string, SolverEmployee>
): SolverHardFlag[] {
  const flags: SolverHardFlag[] = [];
  for (const date of scheduleDates) {
    for (const hour of lateNightHoursOnDate(shifts, date)) {
      const { headcount, roles } = rolesUnionAtHour(shifts, empById, date, hour);
      if (headcount === 0) continue;

      if (headcount < LATE_NIGHT_MIN_HEADCOUNT) {
        flags.push({
          severity: "hard",
          code: "H3_LATE_NIGHT_HEADCOUNT",
          date,
          hour,
          detail: `Late night ${date} ${String(hour).padStart(2, "0")}:00 requires at least ${LATE_NIGHT_MIN_HEADCOUNT} people (found ${headcount}). One multi-role employee does not satisfy headcount.`,
        });
        continue;
      }

      const missing: string[] = [];
      if (!roles.has("COOK")) missing.push("cook");
      if (!roles.has("CASHIER")) missing.push("cashier");
      if (!roles.has("PACKLINER")) missing.push("packliner");
      if (missing.length > 0) {
        flags.push({
          severity: "hard",
          code: "H3_LATE_NIGHT_HEADCOUNT",
          date,
          hour,
          detail: `Late night ${date} ${String(hour).padStart(2, "0")}:00 has ${headcount} people but combined roles missing ${missing.join(", ")}.`,
        });
      }
    }
  }
  return flags;
}

/** Report hours still missing a core role (for metadata warnings). */
export function auditCoreRoleCoverage(
  shifts: ValidatedShift[],
  scheduleDates: string[]
): string[] {
  const gaps: string[] = [];
  for (const date of scheduleDates) {
    const { open, close } = operatingHoursForDate(date);
    for (let hour = open; hour < close; hour++) {
      const c = concurrentRoleCounts(shifts, date, hour);
      const missing: string[] = [];
      if (c.COOK < CORE_ROLE_MIN) missing.push("cook");
      if (c.CASHIER < CORE_ROLE_MIN) missing.push("cashier");
      if (c.PACKLINER < CORE_ROLE_MIN) missing.push("packliner");
      if (missing.length > 0) {
        gaps.push(`${date} ${String(hour).padStart(2, "0")}:00 missing ${missing.join(", ")}`);
      }
    }
  }
  return gaps;
}

export function deduplicateFlags(flags: SolverHardFlag[]): SolverHardFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const key = `${f.code}:${f.date}:${f.hour}:${f.role ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type SolverCallbacks = {
  empById: Map<string, SolverEmployee>;
  availByUser: Map<string, SolverAvailability[]>;
  roleMatches: (emp: SolverEmployee, role: string) => boolean;
  isWithinAvailability: (userId: string, date: string, start: string, end: string) => boolean;
  hasTimeOff: (userId: string, date: string) => boolean;
  maxHoursFor: (emp: SolverEmployee) => number;
};

function initSolverCallbacks(params: {
  employees: SolverEmployee[];
  availability: SolverAvailability[];
  approvedTimeOff: ApprovedTimeOff[];
  preferences: WorkplacePreferences;
}): SolverCallbacks {
  const { employees, availability, approvedTimeOff, preferences } = params;
  const constraints = (preferences.constraints ?? {}) as Record<string, unknown>;
  const maxHoursDefault = (constraints.maxHoursPerWeek as number) ?? 45;

  const empById = new Map<string, SolverEmployee>();
  for (const e of employees) empById.set(e.user_id, e);

  const availByUser = new Map<string, SolverAvailability[]>();
  for (const a of availability) {
    const list = availByUser.get(a.user_id) ?? [];
    list.push(a);
    availByUser.set(a.user_id, list);
  }

  const timeOffByUser = new Map<string, ApprovedTimeOff[]>();
  for (const t of approvedTimeOff) {
    const list = timeOffByUser.get(t.user_id) ?? [];
    list.push(t);
    timeOffByUser.set(t.user_id, list);
  }

  function employeeRolesFor(emp: SolverEmployee): Set<string> {
    const roles = emp.roles?.length ? emp.roles : [emp.role];
    return new Set(roles.map(canonicalRole));
  }

  return {
    empById,
    availByUser,
    roleMatches(emp, role) {
      const roles = employeeRolesFor(emp);
      return roles.has(canonicalRole(role)) || roles.has("STAFF");
    },
    isWithinAvailability(userId, date, start, end) {
      const dow = dowOf(date);
      const blocks = (availByUser.get(userId) ?? []).filter((b) => b.day_of_week === dow);
      const s = toMinutes(start);
      const e = effectiveEndMinutes(end, start);
      return blocks.some((b) => {
        const bs = toMinutes(b.start_time);
        const be = effectiveEndMinutes(b.end_time, b.start_time);
        return bs <= s && be >= e;
      });
    },
    hasTimeOff(userId, date) {
      return (timeOffByUser.get(userId) ?? []).some(
        (t) => t.start_date <= date && t.end_date >= date
      );
    },
    maxHoursFor(emp) {
      return emp.max_hours ?? maxHoursDefault;
    },
  };
}

/** Run Phase 2 floor engine only — before LLM scheduling. */
export function runFloorEngineOnly(params: {
  employees: SolverEmployee[];
  availability: SolverAvailability[];
  approvedTimeOff: ApprovedTimeOff[];
  preferences: WorkplacePreferences;
  workersNeeded: GenerateScheduleResponse["workersNeeded"];
  weekStart: string;
}): { shifts: ValidatedShift[]; gaps: SolverHardFlag[] } {
  const { employees, availability, approvedTimeOff, preferences, workersNeeded, weekStart } = params;
  const demand = workersNeededMaps(workersNeeded, weekStart);
  const roleReq = ((preferences.constraints ?? {}) as Record<string, unknown>).roleRequirements as
    Record<string, Array<{ from: string; to: string; cooks?: number; cashiers?: number; packliners?: number }>> | undefined;
  if (roleReq && Object.keys(roleReq).length > 0) {
    applyRoleRequirements(demand, roleReq);
  }
  const callbacks = initSolverCallbacks({ employees, availability, approvedTimeOff, preferences });

  const accepted: ValidatedShift[] = [];
  const hoursByUser = new Map<string, number>();
  const acceptedSlotKeys = new Set<string>();

  const fillCtx = {
    accepted,
    hoursByUser,
    acceptedSlotKeys,
    employees,
    empById: callbacks.empById,
    availByUser: callbacks.availByUser,
    demand,
    maxHoursFor: callbacks.maxHoursFor,
    isWithinAvailability: callbacks.isWithinAvailability,
    hasTimeOff: callbacks.hasTimeOff,
    roleMatches: callbacks.roleMatches,
  };

  for (let pass = 0; pass < 5; pass++) {
    fillRoleGaps({ ...fillCtx, phase: "floor" });
  }

  const gaps = auditFloorHardFlags(accepted, demand.scheduleDates);
  return { shifts: [...accepted], gaps };
}

/** Log floor coverage verification after schedule generation. */
export function assertFloorCoverage(shifts: ValidatedShift[], scheduleDates: string[]): void {
  const gaps = auditCoreRoleCoverage(shifts, scheduleDates);
  if (gaps.length > 0) {
    console.error("[ScheduleVerification] Floor coverage gaps after generation:");
    for (const g of gaps) console.error(`  ✗ ${g}`);
  } else {
    console.log("[ScheduleVerification] ✓ Full floor coverage achieved — 0 gaps");
  }
}

/**
 * Phase 4b: ensure every available employee gets at least DEFAULT_MIN_SHIFTS_PER_WEEK
 * days of work. Assigns the employee to the day+role where they add the most value
 * (highest understaffing vs demand targets).
 */
function fairnessPass(
  accepted: ValidatedShift[],
  hoursByUser: Map<string, number>,
  acceptedSlotKeys: Set<string>,
  employees: SolverEmployee[],
  empById: Map<string, SolverEmployee>,
  availByUser: Map<string, SolverAvailability[]>,
  demand: WorkersNeededMaps,
  maxHoursFor: (emp: SolverEmployee) => number,
  isWithinAvailability: (userId: string, date: string, start: string, end: string) => boolean,
  hasTimeOff: (userId: string, date: string) => boolean,
  roleMatches: (emp: SolverEmployee, role: string) => boolean,
): void {
  const shiftDaysByUser = new Map<string, Set<string>>();
  for (const sh of accepted) {
    const days = shiftDaysByUser.get(sh.employeeId) ?? new Set<string>();
    days.add(sh.shiftDate);
    shiftDaysByUser.set(sh.employeeId, days);
  }

  const underScheduled = employees
    .filter((e) => {
      const minRequired = Math.max(e.min_shifts ?? 0, DEFAULT_MIN_SHIFTS_PER_WEEK);
      const currentDays = shiftDaysByUser.get(e.user_id)?.size ?? 0;
      return currentDays < minRequired;
    })
    .sort((a, b) => {
      const aDays = shiftDaysByUser.get(a.user_id)?.size ?? 0;
      const bDays = shiftDaysByUser.get(b.user_id)?.size ?? 0;
      return aDays - bDays;
    });

  const fillOrder: StaffingRole[] = ["COOK", "CASHIER", "PACKLINER"];

  for (const emp of underScheduled) {
    const minRequired = Math.max(emp.min_shifts ?? 0, DEFAULT_MIN_SHIFTS_PER_WEEK);
    const scheduledDays = shiftDaysByUser.get(emp.user_id) ?? new Set<string>();

    for (const date of demand.scheduleDates) {
      if (scheduledDays.size >= minRequired) break;
      if (scheduledDays.has(date)) continue;
      if (hasTimeOff(emp.user_id, date)) continue;

      const dow = dowOf(date);
      const blocks = (availByUser.get(emp.user_id) ?? []).filter((b) => b.day_of_week === dow);
      if (blocks.length === 0) continue;

      // Pick the role with the most understaffing on this day
      let bestRole: StaffingRole | null = null;
      let bestDeficit = -Infinity;
      for (const role of fillOrder) {
        if (!roleMatches(emp, role)) continue;
        const { open, close } = operatingHoursForDate(date);
        let deficit = 0;
        for (let h = open; h < close; h++) {
          const target = roleTargetsForHour(demand, date, h)[role];
          const current = concurrentRoleCounts(accepted, date, h)[role];
          deficit += Math.max(0, target - current);
        }
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestRole = role;
        }
      }
      if (!bestRole) continue;

      // Try to assign via bestOperatingShiftWindow on each availability block
      const { open, close } = operatingHoursForDate(date);
      const midHour = Math.floor((open + close) / 2);
      for (const block of blocks) {
        const win = bestOperatingShiftWindow(block.start_time, block.end_time, midHour, date, {
          floorPhase: false,
          demandWindow: { open, close },
        });
        if (!win) continue;
        if (!isWithinAvailability(emp.user_id, date, win.start, win.end)) continue;
        if (shiftsOverlap(accepted, emp.user_id, date, win.start, win.end)) continue;

        const shiftHrs = shiftLengthHours(win.start, win.end);
        const totalHrs = (hoursByUser.get(emp.user_id) ?? 0) + shiftHrs;
        if (totalHrs > maxHoursFor(emp)) continue;

        const slotKey = `${emp.user_id}|${date}|${win.start}|${bestRole}`;
        if (acceptedSlotKeys.has(slotKey)) continue;

        hoursByUser.set(emp.user_id, totalHrs);
        acceptedSlotKeys.add(slotKey);
        accepted.push({
          employeeId: emp.user_id,
          day: DAY_NAMES[dow] ?? "MON",
          shiftDate: date,
          startTime: win.start,
          endTime: win.end,
          role: bestRole,
          location: "Main",
          isEngineSuggested: true,
          llmReasoning: "Solver: fairness — minimum shifts guarantee",
        });
        scheduledDays.add(date);
        break;
      }
    }
  }
}

export function validateAndFill(params: {
  llmSuggestions: LLMShiftSuggestion[];
  baselineShifts: BaselineShift[];
  employees: SolverEmployee[];
  availability: SolverAvailability[];
  approvedTimeOff: ApprovedTimeOff[];
  preferences: WorkplacePreferences;
  weekStart?: string;
  workersNeeded?: GenerateScheduleResponse["workersNeeded"];
}): {
  shifts: ValidatedShift[];
  violationsFixed: number;
  roleCoverageGaps: string[];
  hardFlags: SolverHardFlag[];
  preferenceOverrideFlags: RoleOverrideFlag[];
} {
  const {
    llmSuggestions,
    baselineShifts,
    employees,
    availability,
    approvedTimeOff,
    preferences,
    weekStart,
    workersNeeded,
  } = params;

  if (
    !workersNeeded ||
    (workersNeeded.byHour.length === 0 && workersNeeded.byDay.length === 0)
  ) {
    throw new Error(
      "[ConstraintSolver] workersNeeded is required. " +
        "Cannot run schedule generation without demand data. " +
        "Ensure the ML service has been called and returned predictions before invoking validateAndFill."
    );
  }

  const demand = workersNeededMaps(workersNeeded, weekStart);
  const roleReq = ((preferences.constraints ?? {}) as Record<string, unknown>).roleRequirements as
    Record<string, Array<{ from: string; to: string; cooks?: number; cashiers?: number; packliners?: number }>> | undefined;
  let preferenceOverrideFlags: RoleOverrideFlag[] = [];
  if (roleReq && Object.keys(roleReq).length > 0) {
    const avgWage = (preferences as Record<string, unknown>).avgHourlyWage as number | undefined;
    preferenceOverrideFlags = applyRoleRequirements(demand, roleReq, avgWage ?? undefined);
  }
  const {
    empById,
    availByUser,
    roleMatches,
    isWithinAvailability,
    hasTimeOff,
    maxHoursFor,
  } = initSolverCallbacks({ employees, availability, approvedTimeOff, preferences });

  function validShiftLength(start: string, end: string, allowFloorMin = false): boolean {
    const hours = shiftLengthHours(start, end);
    const minH = allowFloorMin ? FLOOR_MIN_SHIFT_HOURS : MIN_SHIFT_HOURS;
    return hours >= minH && hours <= MAX_SHIFT_HOURS;
  }

  const hoursByUser = new Map<string, number>();
  const accepted: ValidatedShift[] = [];
  const acceptedSlotKeys = new Set<string>();
  let violationsFixed = 0;

  function tryAcceptShift(
    shift: {
      employeeId: string;
      date: string;
      startTime: string;
      endTime: string;
      role: string;
      day?: string;
      location?: string;
      isEngineSuggested?: boolean;
      llmReasoning?: string | null;
    },
    applyDemandCap: boolean
  ): boolean {
    const emp = empById.get(shift.employeeId);
    if (!emp) {
      violationsFixed++;
      return false;
    }
    if (!roleMatches(emp, shift.role)) {
      violationsFixed++;
      return false;
    }
    if (!validShiftLength(shift.startTime, shift.endTime, !applyDemandCap)) {
      violationsFixed++;
      return false;
    }
    if (!isWithinAvailability(shift.employeeId, shift.date, shift.startTime, shift.endTime)) {
      violationsFixed++;
      return false;
    }
    if (hasTimeOff(shift.employeeId, shift.date)) {
      violationsFixed++;
      return false;
    }
    if (shiftsOverlap(accepted, shift.employeeId, shift.date, shift.startTime, shift.endTime)) {
      violationsFixed++;
      return false;
    }
    const shiftHours = shiftLengthHours(shift.startTime, shift.endTime);
    const total = (hoursByUser.get(shift.employeeId) ?? 0) + shiftHours;
    if (total > maxHoursFor(emp)) {
      violationsFixed++;
      return false;
    }
    const slotKey = `${shift.employeeId}|${shift.date}|${shift.startTime}|${canonicalRole(shift.role)}`;
    if (acceptedSlotKeys.has(slotKey)) return false;

    if (
      applyDemandCap &&
      exceedsLabourCap(
        accepted,
        {
          employee_id: shift.employeeId,
          date: shift.date,
          start_time: shift.startTime,
          end_time: shift.endTime,
          role: shift.role,
        },
        demand
      )
    ) {
      violationsFixed++;
      return false;
    }

    // Role cap constraint: check against per-hour role targets from demand maps
    // (which include manager-configured role requirements when set).
    const candidateRole = canonicalRole(shift.role);
    if (isStaffingRole(candidateRole)) {
      for (const hour of hoursCoveredByShift(shift.startTime, shift.endTime)) {
        if (!isOperatingHour(shift.date, hour)) continue;
        const counts = concurrentRoleCounts(accepted, shift.date, hour);
        const targets = roleTargetsForHour(demand, shift.date, hour);
        if (counts[candidateRole] >= targets[candidateRole]) {
          violationsFixed++;
          return false;
        }
      }
    }

    hoursByUser.set(shift.employeeId, total);
    acceptedSlotKeys.add(slotKey);
    accepted.push({
      employeeId: shift.employeeId,
      day: shift.day ?? DAY_NAMES[dowOf(shift.date)] ?? "MON",
      shiftDate: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      role: canonicalRole(shift.role),
      location: shift.location ?? "Main",
      isEngineSuggested: shift.isEngineSuggested ?? true,
      llmReasoning: shift.llmReasoning ?? null,
    });
    return true;
  }

  // ── Phase 1: seed baseline shifts only (no LLM — demand preferences come later) ──
  for (const b of baselineShifts) {
    tryAcceptShift(
      {
        employeeId: b.employeeId,
        date: b.shiftDate,
        startTime: b.startTime,
        endTime: b.endTime,
        role: b.role,
        day: b.day,
        location: b.location ?? "Main",
        isEngineSuggested: b.isEngineSuggested ?? false,
        llmReasoning: b.llmReasoning ?? null,
      },
      false
    );
  }

  const hardFlags: SolverHardFlag[] = [];

  const fillCtx = {
    accepted,
    hoursByUser,
    acceptedSlotKeys,
    employees,
    empById,
    availByUser,
    demand,
    maxHoursFor,
    isWithinAvailability,
    hasTimeOff,
    roleMatches,
  };

  // ── Phase 2: Floor engine — mandatory 1+1+1, ignores labour formula ──
  for (let pass = 0; pass < 5; pass++) {
    violationsFixed += fillRoleGaps({ ...fillCtx, phase: "floor" });
  }

  // Hard flags for any floor slot still empty after all floor passes
  hardFlags.push(...auditFloorHardFlags(accepted, demand.scheduleDates));

  // ── Phase 3: LLM suggestions (demand preferences only, after floor) ──
  for (const s of llmSuggestions) {
    tryAcceptShift(
      {
        employeeId: s.employee_id,
        date: s.date,
        startTime: s.start_time,
        endTime: s.end_time,
        role: s.role,
        llmReasoning: s.reasoning,
      },
      true
    );
  }

  // ── Phase 4: Demand engine — formula extras above floor ──
  for (let pass = 0; pass < 2; pass++) {
    violationsFixed += fillRoleGaps({ ...fillCtx, phase: "demand" });
  }

  // ── Phase 4b: Fairness — guarantee every available employee gets minimum shifts ──
  fairnessPass(
    accepted,
    hoursByUser,
    acceptedSlotKeys,
    employees,
    empById,
    availByUser,
    demand,
    maxHoursFor,
    isWithinAvailability,
    hasTimeOff,
    roleMatches
  );

  // ── Phase 5: Prune over-staffing (never below floor role composition) ──
  violationsFixed += pruneOverScheduling(accepted, demand, empById);

  // ── Phase 6: Merge contiguous same-employee/same-role shifts into one ──
  // (e.g. 10:00–17:00 + 17:00–22:00 Packliner → 10:00–22:00). Coverage-neutral.
  mergeContiguousShifts(accepted);

  // Re-audit H1 after prune — prune may have created new gaps
  hardFlags.push(...auditFloorHardFlags(accepted, demand.scheduleDates));
  hardFlags.push(...auditLateNightHardFlags(accepted, demand.scheduleDates, empById));

  const roleCoverageGaps = auditCoreRoleCoverage(accepted, demand.scheduleDates);

  return {
    shifts: accepted,
    violationsFixed,
    roleCoverageGaps,
    hardFlags: deduplicateFlags(hardFlags),
    preferenceOverrideFlags,
  };
}
