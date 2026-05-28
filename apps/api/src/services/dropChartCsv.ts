/** Parses drop-chart export CSV (e.g. apps/ml-engine/drop_chart_all_days.csv). */

export type ParsedSalesRow = { date: string; hour: number; salesAmount: number };

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[()$]/g, "");
}

/** "April 20 2026" → "2026-04-20" */
export function parseDropChartDate(raw: string): string | null {
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "10:00 AM - 11:00 AM" → 10; "11:00 PM - 12:00 AM" → 23 */
export function parseDropChartHour(timeRange: string): number | null {
  const m = timeRange.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  if (h < 0 || h > 23) return null;
  return h;
}

export function isDropChartCsv(headers: string[]): boolean {
  const norm = headers.map(normalizeKey);
  const hasTime = norm.includes("time");
  const hasSales = norm.some((k) => k === "sales" || k.startsWith("sales"));
  const hasDate = norm.includes("date");
  const hasStandardHour = norm.includes("hour");
  return hasTime && hasSales && hasDate && !hasStandardHour;
}

export function parseDropChartRecord(record: Record<string, string>): ParsedSalesRow | null {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    normalized[normalizeKey(k)] = v;
  }

  const dateRaw = normalized.date;
  const timeRaw = normalized.time;
  const salesKey = Object.keys(normalized).find((k) => k === "sales" || k.startsWith("sales_"));
  if (!dateRaw || !timeRaw || !salesKey) return null;

  const date = parseDropChartDate(dateRaw);
  const hour = parseDropChartHour(timeRaw);
  const salesAmount = parseFloat(normalized[salesKey].replace(/,/g, ""));
  if (!date || hour === null || Number.isNaN(salesAmount)) return null;

  return { date, hour, salesAmount };
}
