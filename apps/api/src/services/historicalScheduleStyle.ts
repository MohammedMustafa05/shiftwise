import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { operatingHoursForDate } from "../utils/labourDemand.js";

export type HistoricalShift = {
  employee: string;
  dow: string;
  start: string;
  end: string;
};

type HistoricalWeek = {
  source: string;
  week_ending: string | null;
  shifts: HistoricalShift[];
};

type HistoricalFixture = {
  restaurant: string;
  weeks: HistoricalWeek[];
};

/** Clearview PDF name → demo roster first name (seedRestaurantRoster). */
export const LSL_NAME_ALIASES: Record<string, string> = {
  "ghanva a.": "Gazia",
  "syed aayan a.": "Ayaan",
  "mehran a.": "Mehran",
  "omrah b.": "Umrah",
  "rupali b.": "Rupali",
  "sakeena c.": "Sakina",
  "aaima f.": "Ayma",
  "syed h.": "Hasan",
  "abdul nafay k.": "Nafey",
  "hassan k.": "Hasan",
  "inayah k.": "Inaya",
  "ghunwah m.": "Ganma",
  "ghazia n.": "Gazia",
  "logan p.": "Logan",
  "syed mehrab ali r.": "Merab",
  "shahmeer r.": "Shahmeer",
  "sana s.": "Kanza",
  "pankaj s.": "Pankaj",
  "s.": "Simran",
  "syed muhammad kazim hasnain z.": "Kazim",
};

/** Preferred shift windows from Milton LSL historical Clearview schedules. */
export const LSL_SHIFT_TEMPLATES: Array<{ start: string; end: string; weight: number }> = [
  { start: "17:00", end: "22:00", weight: 23 },
  { start: "10:00", end: "22:00", weight: 16 },
  { start: "10:00", end: "17:00", weight: 13 },
  { start: "11:00", end: "17:00", weight: 5 },
  { start: "10:00", end: "13:00", weight: 4 },
  { start: "17:00", end: "23:00", weight: 3 },
  { start: "10:00", end: "16:00", weight: 3 },
  { start: "10:30", end: "17:00", weight: 2 },
  { start: "12:00", end: "18:00", weight: 2 },
];

let cachedFixture: HistoricalFixture | null = null;

function fixturePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "../../fixtures/lsl-historical-schedules.json");
}

export function loadHistoricalFixture(): HistoricalFixture | null {
  if (cachedFixture) return cachedFixture;
  const fp = fixturePath();
  if (!fs.existsSync(fp)) return null;
  try {
    cachedFixture = JSON.parse(fs.readFileSync(fp, "utf8")) as HistoricalFixture;
    return cachedFixture;
  } catch {
    return null;
  }
}

export function allHistoricalShifts(): HistoricalShift[] {
  const fixture = loadHistoricalFixture();
  if (!fixture) return [];
  return fixture.weeks.flatMap((w) => w.shifts);
}

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let endM = eh * 60 + em;
  const startM = sh * 60 + sm;
  if (endM <= startM) endM += 24 * 60;
  return (endM - startM) / 60;
}

function topTemplates(shifts: HistoricalShift[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const s of shifts) {
    const key = `${s.start}-${s.end}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, n]) => `${k.replace("-", "–")} (${n}× in sample weeks)`);
}

function employeePatterns(shifts: HistoricalShift[]): Map<string, string> {
  const byEmp = new Map<string, HistoricalShift[]>();
  for (const s of shifts) {
    const list = byEmp.get(s.employee) ?? [];
    list.push(s);
    byEmp.set(s.employee, list);
  }
  const out = new Map<string, string>();
  for (const [emp, arr] of byEmp) {
    const tpl = topTemplates(arr, 3).map((t) => t.split(" (")[0]).join(", ");
    const full = arr.filter((s) => shiftHours(s.start, s.end) >= 10).length;
    const close = arr.filter((s) => s.start >= "16:00").length;
    const open = arr.filter((s) => s.end <= "17:00" && s.start <= "12:00").length;
    let style = "mixed";
    if (full >= arr.length * 0.5) style = "often full-day (10–22)";
    else if (close >= arr.length * 0.6) style = "mostly evening close (17–22)";
    else if (open >= arr.length * 0.5) style = "mostly open block (10–17)";
    out.set(emp, `typical windows: ${tpl || "varied"}; ${style}`);
  }
  return out;
}

/** Build prompt lines teaching the LLM how this restaurant actually schedules. */
export function buildHistoricalStylePromptLines(
  rosterNames?: string[]
): string[] {
  const shifts = allHistoricalShifts();
  if (shifts.length === 0) return [];

  const fixture = loadHistoricalFixture()!;
  const lines: string[] = [];
  lines.push(
    `HISTORICAL LSL SCHEDULE STYLE (${fixture.restaurant}, ${fixture.weeks.length} Clearview week(s), ${shifts.length} shifts):`
  );
  lines.push(
    "- Match real manager patterns: use OPEN block (10:00–17:00) + CLOSE block (17:00–22:00) crews; do NOT give everyone one truncated 10:00–16:00 shift."
  );
  lines.push(
    "- Hourly floor still requires 1 COOK + 1 CASHIER + 1 PACKLINER every hour 10:00–21:59 — achieve via overlapping shifts, not one person working 12h unless they did historically."
  );
  lines.push("- Most common shift templates in historical data:");
  for (const t of topTemplates(shifts, 8)) {
    lines.push(`  • ${t}`);
  }

  const patterns = employeePatterns(shifts);
  const rosterSet = rosterNames
    ? new Set(rosterNames.map((n) => n.toLowerCase()))
    : null;
  lines.push("- Per-person historical habits (prefer when available):");
  for (const name of [...patterns.keys()].sort()) {
    if (rosterSet && !rosterSet.has(name.toLowerCase())) continue;
    lines.push(`  • ${name}: ${patterns.get(name)}`);
  }

  return lines;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function windowFitsAvailability(
  start: string,
  end: string,
  availStart: string,
  availEnd: string,
  hour: number
): boolean {
  const aS = toMinutes(availStart);
  let aE = toMinutes(availEnd);
  if (aE <= aS) aE += 24 * 60;
  const wS = toMinutes(start);
  let wE = toMinutes(end);
  if (wE <= wS) wE += 24 * 60;
  const hS = hour * 60;
  const hE = hS + 60;
  return wS >= aS && wE <= aE && hS >= wS && hE <= wE;
}

/** Pick open/close/full window for solver fill (matches LSL historical style). */
export function bestShiftWindowForHour(
  availStart: string,
  availEnd: string,
  hour: number,
  date?: string
): { start: string; end: string } | null {
  const opStart = 10 * 60;
  // Use date-specific close hour so Friday/Saturday (close=24) get midnight templates.
  const { close: closeHour } = date ? operatingHoursForDate(date) : { close: 22 };
  const opEnd = closeHour * 60;
  const closingTime = `${String(closeHour % 24).padStart(2, "0")}:00`;

  const aS = Math.max(toMinutes(availStart), opStart);
  let aE = Math.min(toMinutes(availEnd), opEnd);
  if (toMinutes(availEnd) <= toMinutes(availStart)) {
    // Midnight-crossing availability: treat "00:00" end as next-day midnight.
    aE = Math.min(toMinutes(availEnd) + 24 * 60, opEnd + 24 * 60);
  }
  if (aE - aS < 3 * 60) return null;

  // Prefer templates that include the target hour; add closing-time variants when
  // the store closes after 22:00 (Friday/Saturday close at midnight).
  // 10:00-22:00 is intentionally excluded from morning preferences — it produces 12h shifts.
  // For evening hours it appears last as an absolute fallback only.
  const lateTemplates = closeHour > 22
    ? [`17:00-${closingTime}`, `11:00-${closingTime}`]
    : [];
  const hourPref =
    hour < 17
      ? ["10:00-17:00", "11:00-17:00", "10:00-16:00", "10:00-13:00", ...lateTemplates]
      : [...lateTemplates, "17:00-22:00", "17:00-23:00", "15:00-22:00", "16:00-22:00"];

  for (const key of hourPref) {
    const [start, end] = key.split("-");
    if (windowFitsAvailability(start, end, availStart, availEnd, hour)) {
      return { start, end };
    }
  }

  const hStart = hour * 60;
  const hEnd = hStart + 60;
  if (hStart >= aS && hEnd <= aE) {
    // No standard template fit (e.g. employee available until 9 PM, templates end at 10 PM).
    // Build a natural-boundary shift capped to 7 hours so we don't assign all-day spans.
    const blockStart = hour < 17
      ? Math.max(aS, opStart)   // morning gap → anchor at store open or avail start
      : Math.max(aS, 17 * 60);  // evening gap → anchor at 5 PM if possible
    const blockEnd = Math.min(aE, blockStart + 7 * 60);
    if (hStart >= blockStart && hEnd <= blockEnd) {
      return { start: fromMinutes(blockStart), end: fromMinutes(blockEnd) };
    }
    // If the hour is outside that 7h block (e.g. very late evening), use a tight window.
    const tightStart = Math.max(aS, hStart - 60);
    const tightEnd = Math.min(aE, hEnd + 2 * 60);
    if (tightEnd > tightStart) {
      return { start: fromMinutes(tightStart), end: fromMinutes(tightEnd) };
    }
  }
  return null;
}
