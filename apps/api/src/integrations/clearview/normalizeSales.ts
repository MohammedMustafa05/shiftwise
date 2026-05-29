import type { HourlySalesRow } from "@shiftagent/shared";
import { addDays, formatDate, getWeekStart } from "../../utils/dates.js";

/** Build 7×24 rows for a week from fixture entries (sparse → fill zeros). */
export function normalizeSalesToWeek(
  rows: HourlySalesRow[],
  weekStart: string
): HourlySalesRow[] {
  const start = getWeekStart(new Date(`${weekStart}T12:00:00Z`));
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(`${r.date}:${r.hour}`, r.salesAmount);
  }
  const result: HourlySalesRow[] = [];
  for (let d = 0; d < 7; d++) {
    const date = formatDate(addDays(start, d));
    for (let hour = 0; hour < 24; hour++) {
      result.push({
        date,
        hour,
        salesAmount: map.get(`${date}:${hour}`) ?? 0,
      });
    }
  }
  return result;
}

export function mapRawClearviewSales(
  raw: Array<{ date: string; hour: number; amount: number }>
): HourlySalesRow[] {
  return raw.map((r) => ({
    date: r.date,
    hour: r.hour,
    salesAmount: r.amount,
  }));
}
