export type BlockKey = "morning" | "evening" | "full" | "off";

export type DayBlockSelection = {
  dayOfWeek: number;
  block: BlockKey;
  startTime: string;
  endTime: string;
  label: string;
  hours: number;
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const WEEKDAY_BLOCKS: Record<BlockKey, { label: string; startTime: string; endTime: string; hours: number }> = {
  morning: { label: "Morning", startTime: "10:00", endTime: "16:00", hours: 6 },
  evening: { label: "Evening", startTime: "16:00", endTime: "22:00", hours: 6 },
  full: { label: "Full Day", startTime: "10:00", endTime: "22:00", hours: 12 },
  off: { label: "Day Off", startTime: "00:00", endTime: "00:00", hours: 0 },
};

const WEEKEND_BLOCKS: Record<BlockKey, { label: string; startTime: string; endTime: string; hours: number }> = {
  morning: { label: "Morning", startTime: "10:00", endTime: "17:00", hours: 7 },
  evening: { label: "Evening", startTime: "17:00", endTime: "00:00", hours: 7 },
  full: { label: "Full Day", startTime: "10:00", endTime: "00:00", hours: 14 },
  off: { label: "Day Off", startTime: "00:00", endTime: "00:00", hours: 0 },
};

export function blockDefsForDay(dayOfWeek: number) {
  return dayOfWeek === 5 || dayOfWeek === 6 ? WEEKEND_BLOCKS : WEEKDAY_BLOCKS;
}

export function dayNameFromDow(dayOfWeek: number) {
  return DAY_NAMES[dayOfWeek] ?? "monday";
}

export function selectionsFromGrid(grid: Record<string, unknown>): DayBlockSelection[] {
  const out: DayBlockSelection[] = [];
  const dayIndex: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  for (const [day, value] of Object.entries(grid ?? {})) {
    const dow = dayIndex[day.toLowerCase()];
    if (dow === undefined) continue;
    const defs = blockDefsForDay(dow);
    if (typeof value === "string" && value in defs) {
      const block = value as BlockKey;
      const d = defs[block];
      out.push({
        dayOfWeek: dow,
        block,
        startTime: d.startTime,
        endTime: d.endTime,
        label: d.label,
        hours: d.hours,
      });
      continue;
    }
    if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
      const item = value[0] as { block?: BlockKey; startTime?: string; endTime?: string; label?: string };
      if (item.block && item.startTime && item.endTime) {
        const d = defs[item.block];
        out.push({
          dayOfWeek: dow,
          block: item.block,
          startTime: item.startTime,
          endTime: item.endTime,
          label: item.label ?? d.label,
          hours: d.hours,
        });
      }
    }
  }
  return out.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

export function gridFromSelections(selections: DayBlockSelection[]) {
  const grid: Record<string, { block: BlockKey; startTime: string; endTime: string; label: string }[]> = {};
  for (const s of selections) {
    const day = dayNameFromDow(s.dayOfWeek);
    grid[day] = [
      { block: s.block, startTime: s.startTime, endTime: s.endTime, label: s.label },
    ];
  }
  return grid;
}

export function totalHoursFromSelections(selections: DayBlockSelection[]) {
  return selections.reduce((sum, s) => sum + s.hours, 0);
}

export function selectionFromBlockInput(
  dayOfWeek: number,
  block: BlockKey,
): DayBlockSelection {
  const defs = blockDefsForDay(dayOfWeek);
  const d = defs[block];
  return {
    dayOfWeek,
    block,
    startTime: d.startTime,
    endTime: d.endTime,
    label: d.label,
    hours: d.hours,
  };
}

/** Build a grid preserving exact start/end times (for partial or custom windows). */
export function gridFromCustomBlocks(
  blocks: Array<{ dayOfWeek: number; startTime: string; endTime: string }>
) {
  const grid: Record<
    string,
    { block: BlockKey; startTime: string; endTime: string; label: string }[]
  > = {};
  for (const b of blocks) {
    const day = dayNameFromDow(b.dayOfWeek);
    const matched = matchBlockFromTimes(b.dayOfWeek, b.startTime, b.endTime) ?? "morning";
    grid[day] = [
      {
        block: matched,
        startTime: b.startTime,
        endTime: b.endTime,
        label: `${b.startTime.slice(0, 5)}–${b.endTime.slice(0, 5)}`,
      },
    ];
  }
  return grid;
}

export function matchBlockFromTimes(
  dayOfWeek: number,
  startTime: string,
  endTime: string,
): BlockKey | null {
  const defs = blockDefsForDay(dayOfWeek);
  const norm = (t: string) => t.slice(0, 5);
  for (const key of Object.keys(defs) as BlockKey[]) {
    const d = defs[key];
    if (norm(d.startTime) === norm(startTime) && norm(d.endTime) === norm(endTime)) {
      return key;
    }
  }
  return null;
}

export function formatDayLabel(dayOfWeek: number) {
  const labels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return labels[dayOfWeek] ?? "Day";
}

/** Expand stored grid (block objects or legacy start/end pairs) to hourly slots for web UI. */
export function hoursBetween(startTime: string, endTime: string): string[] {
  const startH = parseInt(startTime.slice(0, 2), 10);
  let endH = parseInt(endTime.slice(0, 2), 10);
  const endM = parseInt(endTime.slice(3, 5) || "0", 10);
  if (endH === 0 && endM === 0) endH = 24;
  if (endH <= startH) endH += 24;
  const hours: string[] = [];
  for (let h = startH; h < endH; h++) {
    const hr = h >= 24 ? h - 24 : h;
    hours.push(`${String(hr).padStart(2, "0")}:00`);
  }
  return hours;
}

export function gridToHourlySlots(grid: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of selectionsFromGrid(grid)) {
    const day = dayNameFromDow(s.dayOfWeek);
    out[day] = s.block === "off" ? [] : hoursBetween(s.startTime, s.endTime);
  }
  return out;
}
