import type { GenerateScheduleResponse, WorkplacePreferences } from "@shiftwise/shared";
import { addDays, formatDate, getWeekStart, parseTimeToHours } from "../utils/dates.js";

export type ScheduleEmployee = {
  userId: string;
  role: string;
  maxHoursPerWeek: number;
};

export type ScheduleAvailability = {
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type OperatingHours = { open: string; close: string };

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

function parseHour(time: string): number {
  return parseInt(time.slice(0, 2), 10);
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Monday-based offset: Sun=6, Mon=0, … Sat=5 */
function dayOffsetFromMonday(dow: number): number {
  return dow === 0 ? 6 : dow - 1;
}

function clampShiftToOperatingHours(
  startTime: string,
  endTime: string,
  hours: OperatingHours,
  shiftLengthHours: number
): { startTime: string; endTime: string } | null {
  const openH = parseHour(hours.open);
  const closeH = parseHour(hours.close);
  let startH = Math.max(parseHour(startTime), openH);
  let endH = Math.min(parseHour(endTime), closeH);
  if (endH <= startH) return null;

  if (endH - startH > shiftLengthHours) {
    endH = startH + shiftLengthHours;
  }
  if (endH > closeH) endH = closeH;
  if (endH <= startH) return null;

  return { startTime: formatHour(startH), endTime: formatHour(endH) };
}

/**
 * Build a draft schedule from workplace preferences and employee availability
 * (no ML engine or sales data required).
 */
export function generateLocalSchedule(
  weekStart: string,
  preferences: WorkplacePreferences,
  operatingHours: OperatingHours,
  employees: ScheduleEmployee[],
  availability: ScheduleAvailability[]
): Omit<GenerateScheduleResponse, "scheduleId"> {
  const constraints = (preferences.constraints ?? {}) as Record<string, unknown>;
  const maxHoursDefault = (constraints.maxHoursPerWeek as number) ?? 45;
  const shiftLengthHours = preferences.shiftLengthHours ?? 8;

  const weekAnchor = getWeekStart(new Date(`${weekStart}T12:00:00Z`));
  const availByUser = new Map<string, ScheduleAvailability[]>();
  for (const block of availability) {
    const list = availByUser.get(block.userId) ?? [];
    list.push(block);
    availByUser.set(block.userId, list);
  }

  const hoursByUser = new Map<string, number>();
  const shifts: GenerateScheduleResponse["shifts"] = [];
  const flags: GenerateScheduleResponse["flags"] = [];

  for (const emp of employees) {
    const blocks = availByUser.get(emp.userId) ?? [];
    const maxWeek = emp.maxHoursPerWeek || maxHoursDefault;
    let weekHours = hoursByUser.get(emp.userId) ?? 0;

    for (const block of blocks) {
      if (weekHours >= maxWeek) break;

      const clamped = clampShiftToOperatingHours(
        block.startTime,
        block.endTime,
        operatingHours,
        shiftLengthHours
      );
      if (!clamped) continue;

      let duration = parseTimeToHours(clamped.startTime, clamped.endTime);
      if (weekHours + duration > maxWeek) {
        const allowed = maxWeek - weekHours;
        if (allowed < 1) break;
        const endH = parseHour(clamped.startTime) + Math.floor(allowed);
        clamped.endTime = formatHour(endH);
        duration = parseTimeToHours(clamped.startTime, clamped.endTime);
      }

      weekHours += duration;
      hoursByUser.set(emp.userId, weekHours);

      const shiftDate = formatDate(addDays(weekAnchor, dayOffsetFromMonday(block.dayOfWeek)));
      shifts.push({
        id: crypto.randomUUID(),
        employeeId: emp.userId,
        day: DAY_NAMES[block.dayOfWeek] ?? "MON",
        shiftDate,
        startTime: clamped.startTime,
        endTime: clamped.endTime,
        role: emp.role,
        location: "Main",
      });
    }
  }

  if (employees.length === 0) {
    flags.push({ type: "understaffed", message: "No employees in roster" });
  } else if (shifts.length === 0) {
    flags.push({
      type: "no_availability",
      message: "No shifts could be built from employee availability and operating hours",
    });
  }

  const byDay: GenerateScheduleResponse["workersNeeded"]["byDay"] = [];
  for (let d = 0; d < 7; d++) {
    const date = formatDate(addDays(weekAnchor, d));
    const dayShifts = shifts.filter((s) => s.shiftDate === date);
    byDay.push({ date, sales: 0, workers: dayShifts.length });
  }

  return {
    status: "draft",
    workersNeeded: { byHour: [], byDay },
    shifts,
    flags,
  };
}
