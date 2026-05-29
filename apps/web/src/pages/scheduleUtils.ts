import type { Employee, LlmSuggestedShift, PreferenceOverride, Role, Shift } from '../lib/types';

export type ParsedTime = { hours: number; minutes: number };

export type AISuggestionStatus = 'pending' | 'accepted' | 'kept';

export type ParsedOverrideShift = {
  employeeName: string;
  role?: string;
  date?: string;
  start?: string;
  end?: string;
};

export function parseTimeString(time: string): ParsedTime {
  const [h, m] = time.split(':').map(Number);
  return { hours: h, minutes: m || 0 };
}

export function parsedTimeToDecimal(time: ParsedTime): number {
  return time.hours + time.minutes / 60;
}

export function shiftDurationHours(start: ParsedTime, end: ParsedTime): number {
  let endH = end.hours + end.minutes / 60;
  const startH = parsedTimeToDecimal(start);
  if (endH <= startH) endH += 24;
  return Math.round((endH - startH) * 10) / 10;
}

export function shiftDurationFromStrings(start: string, end: string): number {
  return shiftDurationHours(parseTimeString(start), parseTimeString(end));
}

export function formatTime12FromString(time: string): string {
  const { hours, minutes } = parseTimeString(time);
  let h = hours;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return minutes ? `${h}:${String(minutes).padStart(2, '0')} ${ampm}` : `${h} ${ampm}`;
}

export function formatShiftPillLabel(start: string, end: string): string {
  const fmt = (time: string) => {
    const { hours, minutes } = parseTimeString(time);
    let h = hours;
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    if (minutes) return `${h}:${String(minutes).padStart(2, '0')}${ampm}`;
    return `${h}${ampm}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export function displayNameShort(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? name;
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? '';
  return `${parts[0]} ${lastInitial}.`;
}

export function parseOverrideLine(line: string): ParsedOverrideShift | null {
  const match = line.match(/^(.+?) — (\w+) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})–(\d{2}:\d{2})$/);
  if (!match) return { employeeName: line };
  return {
    employeeName: match[1],
    role: match[2],
    date: match[3],
    start: match[4],
    end: match[5],
  };
}

export function inferShiftName(start: string, end: string): string {
  const hours = shiftDurationFromStrings(start, end);
  const startH = parseTimeString(start).hours;
  if (hours >= 10) return 'Full Day';
  if (startH < 12) return 'Morning Shift';
  return 'Evening Shift';
}

export type ShiftStyle = { bg: string; text: string };

export function getShiftStyle(start: string, end: string): ShiftStyle {
  const hours = shiftDurationFromStrings(start, end);
  const startH = parseTimeString(start).hours;
  if (hours >= 10) {
    return { bg: 'rgba(99,102,241,0.28)', text: '#A5B4FC' };
  }
  if (startH < 12) {
    return { bg: 'rgba(129,140,248,0.22)', text: '#93C5FD' };
  }
  return { bg: 'rgba(167,139,250,0.22)', text: '#C4B5FD' };
}

export function weekTotalColor(hours: number): string {
  if (hours < 20) return '#FBBF24';
  if (hours > 44) return '#F87171';
  return '#34D399';
}

export function findShiftForOverride(
  shifts: Shift[],
  scheduled: ParsedOverrideShift,
): Shift | undefined {
  if (!scheduled.date || !scheduled.start || !scheduled.end) return undefined;
  return shifts.find((s) => {
    const name = s.employee?.name ?? '';
    const nameMatch =
      name === scheduled.employeeName ||
      name.startsWith(scheduled.employeeName.split(' ')[0]);
    return (
      nameMatch &&
      s.date === scheduled.date &&
      s.start_time.slice(0, 5) === scheduled.start &&
      s.end_time.slice(0, 5) === scheduled.end
    );
  });
}

export const ROLE_PILL: Record<Role, { bg: string; text: string; label: string }> = {
  Cook: { bg: 'rgba(248,113,113,0.18)', text: '#F87171', label: 'Cook' },
  Packliner: { bg: 'rgba(52,211,153,0.18)', text: '#34D399', label: 'Packer' },
  Cashier: { bg: 'rgba(129,140,248,0.18)', text: '#818CF8', label: 'Cashier' },
};

function normTime(t: string): string {
  return t.slice(0, 5);
}

function employeeUserId(emp: Employee): string {
  return (emp as Employee & { userId?: string }).userId ?? emp.id;
}

function shiftMatchesLlm(shift: Shift, llm: LlmSuggestedShift, employees: Employee[]): boolean {
  const emp = shift.employee ?? employees.find((e) => e.id === shift.employee_id);
  if (!emp) return false;
  const userId = employeeUserId(emp);
  return (
    (userId === llm.employeeId || shift.employee_id === llm.employeeId || emp.id === llm.employeeId) &&
    shift.date === llm.shiftDate
  );
}

function formatOverrideLine(
  name: string,
  role: string,
  date: string,
  start: string,
  end: string,
): string {
  return `${name} — ${role} ${date} ${normTime(start)}–${normTime(end)}`;
}

/** Build AI suggestion list from API overrides or LLM vs scheduled diff. */
export function buildAiSuggestions(
  preferenceOverrides: PreferenceOverride[] | undefined,
  llmSuggestedShifts: LlmSuggestedShift[] | undefined,
  currentShifts: Shift[],
  employees: Employee[],
): PreferenceOverride[] {
  if (preferenceOverrides?.length) {
    return preferenceOverrides;
  }

  if (!llmSuggestedShifts?.length) return [];

  const out: PreferenceOverride[] = [];
  for (const llm of llmSuggestedShifts) {
    const emp =
      employees.find((e) => employeeUserId(e) === llm.employeeId) ??
      employees.find((e) => e.id === llm.employeeId);
    const name = emp?.name ?? 'Employee';
    const scheduled = currentShifts.find((s) => shiftMatchesLlm(s, llm, employees));
    if (!scheduled) continue;

    const llmStart = normTime(llm.startTime);
    const llmEnd = normTime(llm.endTime);
    const schedStart = normTime(scheduled.start_time);
    const schedEnd = normTime(scheduled.end_time);

    if (llmStart === schedStart && llmEnd === schedEnd) continue;

    out.push({
      employeeName: name,
      suggested: formatOverrideLine(name, llm.role, llm.shiftDate, llmStart, llmEnd),
      scheduled: formatOverrideLine(name, scheduled.role, scheduled.date, schedStart, schedEnd),
      reason: 'Schedule adjusted from AI recommendation',
    });
  }
  return out;
}
