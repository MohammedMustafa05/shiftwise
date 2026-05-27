export function parseTimeToHour(time: string): number {
  const match = time.match(/(\d+)(AM|PM)/i);
  if (!match) return 0;
  let hour = parseInt(match[1], 10);
  const period = match[2].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour;
}

export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12} ${period}`;
}

export function formatHourDetailed(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:00 ${period}`;
}

export function formatTimeRange(startHour: number, endHour: number): string {
  return `${formatHourDetailed(startHour)} – ${formatHourDetailed(endHour)}`;
}

export function formatTimeRangeShort(start: string, end: string): string {
  return `${start}–${end}`;
}

export const TIMELINE_START_HOUR = 6;
export const TIMELINE_END_HOUR = 23;
export const TIMELINE_ROW_HEIGHT = 64;
export const TIMELINE_TOTAL_HEIGHT =
  (TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1) * TIMELINE_ROW_HEIGHT;

export const AVAIL_START_HOUR = 6;
export const AVAIL_END_HOUR = 22;
export const AVAIL_BLOCK_HEIGHT = 56;

export function hourToTimelineTop(hour: number): number {
  return (hour - TIMELINE_START_HOUR) * TIMELINE_ROW_HEIGHT;
}

export function durationToHeight(startHour: number, endHour: number): number {
  return (endHour - startHour) * TIMELINE_ROW_HEIGHT;
}

export function getCurrentTimePosition(): number {
  const now = new Date();
  const decimal = now.getHours() + now.getMinutes() / 60;
  if (decimal < TIMELINE_START_HOUR || decimal > TIMELINE_END_HOUR + 1) return -1;
  return (decimal - TIMELINE_START_HOUR) * TIMELINE_ROW_HEIGHT;
}

export function formatHourBlockLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12} ${period}`;
}

export function formatRangePill(startHour: number, endHour: number): string {
  return `${formatHourDetailed(startHour)} – ${formatHourDetailed(endHour + 1)}`;
}
