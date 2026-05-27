/** Monday 00:00 of the week containing `date`. */
export function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Previous calendar week Mon–Sun relative to `reference`. */
export function getPreviousWeekRange(reference: Date = new Date()): {
  weekStart: string;
  weekEnd: string;
} {
  const thisMonday = getWeekStart(reference);
  const prevMonday = addDays(thisMonday, -7);
  const prevSunday = addDays(prevMonday, 6);
  return {
    weekStart: formatDate(prevMonday),
    weekEnd: formatDate(prevSunday),
  };
}

export function parseTimeToHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}
