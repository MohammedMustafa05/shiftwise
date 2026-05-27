import { parse } from "csv-parse/sync";
import type { HourlySalesRow } from "@shiftwise/shared";
import { query } from "../db/pool.js";

const COLUMN_ALIASES: Record<string, keyof HourlySalesRow | "salesAmount"> = {
  date: "date",
  sale_date: "date",
  hour: "hour",
  sales_amount: "salesAmount",
  salesamount: "salesAmount",
  amount: "salesAmount",
  sales: "salesAmount",
};

export async function importSalesCsv(
  workplaceId: string,
  buffer: Buffer
): Promise<{ rowsAccepted: number; rowsRejected: number; dateRange: { from: string | null; to: string | null } }> {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  let accepted = 0;
  let rejected = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const record of records) {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(record)) {
      normalized[k.toLowerCase().replace(/\s+/g, "_")] = v;
    }

    const dateKey = Object.keys(normalized).find((k) => COLUMN_ALIASES[k] === "date");
    const hourKey = Object.keys(normalized).find((k) => COLUMN_ALIASES[k] === "hour");
    const amountKey = Object.keys(normalized).find((k) => COLUMN_ALIASES[k] === "salesAmount");

    if (!dateKey || !hourKey || !amountKey) {
      rejected++;
      continue;
    }

    const date = normalized[dateKey];
    const hour = parseInt(normalized[hourKey], 10);
    const salesAmount = parseFloat(normalized[amountKey]);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(hour) || hour < 0 || hour > 23 || isNaN(salesAmount)) {
      rejected++;
      continue;
    }

    await query(
      `INSERT INTO hourly_sales_data (workplace_id, sale_date, hour, sales_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET sales_amount = EXCLUDED.sales_amount`,
      [workplaceId, date, hour, salesAmount]
    );
    accepted++;
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  }

  return {
    rowsAccepted: accepted,
    rowsRejected: rejected,
    dateRange: { from: minDate, to: maxDate },
  };
}
