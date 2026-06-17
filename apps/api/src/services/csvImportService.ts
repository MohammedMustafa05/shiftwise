import { parse } from "csv-parse/sync";
import type { HourlySalesRow } from "@shiftagent/shared";
import { query } from "../db/pool.js";
import {
  isDropChartCsv,
  parseDropChartRecord,
  type ParsedSalesRow,
} from "./dropChartCsv.js";
import {
  dayOfWeekFromDate,
  isAnomalyDate,
  isClearviewCashSheetBuffer,
  parseClearviewCashSheetBuffer,
} from "./clearviewCashSheet.js";
import { fileURLToPath } from "url";

const COLUMN_ALIASES: Record<string, keyof HourlySalesRow | "salesAmount"> = {
  date: "date",
  sale_date: "date",
  hour: "hour",
  sales_amount: "salesAmount",
  salesamount: "salesAmount",
  amount: "salesAmount",
  sales: "salesAmount",
};

export type SalesImportResult = {
  rowsAccepted: number;
  rowsRejected: number;
  dateRange: { from: string | null; to: string | null };
  format: "standard" | "drop_chart" | "clearview_cash_sheet";
};

type SalesUpsertMeta = {
  dayOfWeek?: number;
  isAnomaly?: boolean;
  anomalyReason?: string | null;
  dataSource?: string;
  transactionCount?: number;
  sourceFile?: string;
};

async function upsertSalesRow(
  workplaceId: string,
  date: string,
  hour: number,
  salesAmount: number,
  stats: { accepted: number; minDate: string | null; maxDate: string | null },
  meta: SalesUpsertMeta = {}
): Promise<void> {
  const dayOfWeek = meta.dayOfWeek ?? dayOfWeekFromDate(date);
  const isAnomaly = meta.isAnomaly ?? isAnomalyDate(date);
  const anomalyReason =
    meta.anomalyReason ?? (isAnomaly ? "Victoria Day holiday — exclude from ML training" : null);

  await query(
    `INSERT INTO hourly_sales_data
       (workplace_id, sale_date, hour, sales_amount, day_of_week,
        is_anomaly, anomaly_reason, data_source, transaction_count, source_file)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET
       sales_amount = EXCLUDED.sales_amount,
       day_of_week = EXCLUDED.day_of_week,
       is_anomaly = EXCLUDED.is_anomaly,
       anomaly_reason = EXCLUDED.anomaly_reason,
       data_source = EXCLUDED.data_source,
       transaction_count = EXCLUDED.transaction_count,
       source_file = EXCLUDED.source_file`,
    [
      workplaceId,
      date,
      hour,
      salesAmount,
      dayOfWeek,
      isAnomaly,
      anomalyReason,
      meta.dataSource ?? "cash_sheet",
      meta.transactionCount ?? null,
      meta.sourceFile ?? null,
    ]
  );
  stats.accepted++;
  if (!stats.minDate || date < stats.minDate) stats.minDate = date;
  if (!stats.maxDate || date > stats.maxDate) stats.maxDate = date;
}

function parseStandardRecord(record: Record<string, string>): ParsedSalesRow | null {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    normalized[k.toLowerCase().replace(/\s+/g, "_")] = v;
  }

  const dateKey = Object.keys(normalized).find((k) => COLUMN_ALIASES[k] === "date");
  const hourKey = Object.keys(normalized).find((k) => COLUMN_ALIASES[k] === "hour");
  const amountKey = Object.keys(normalized).find((k) => COLUMN_ALIASES[k] === "salesAmount");

  if (!dateKey || !hourKey || !amountKey) return null;

  const date = normalized[dateKey];
  const hour = parseInt(normalized[hourKey], 10);
  const salesAmount = parseFloat(normalized[amountKey].replace(/,/g, ""));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(hour) || hour < 0 || hour > 23 || Number.isNaN(salesAmount)) {
    return null;
  }

  return { date, hour, salesAmount };
}

export async function importSalesCsv(
  workplaceId: string,
  buffer: Buffer,
  options?: { saleDate?: string }
): Promise<SalesImportResult> {
  if (isClearviewCashSheetBuffer(buffer)) {
    const saleDate = options?.saleDate;
    if (!saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
      throw new Error(
        "Clearview cash sheet requires saleDate query param (YYYY-MM-DD) — one file = one day"
      );
    }
    const records = parseClearviewCashSheetBuffer(buffer);
    const stats = { accepted: 0, minDate: saleDate, maxDate: saleDate };
    for (const r of records) {
      await upsertSalesRow(workplaceId, saleDate, r.hour, r.total_sales, stats, {
        dayOfWeek: dayOfWeekFromDate(saleDate),
        transactionCount: r.transaction_count,
        dataSource: "cash_sheet",
      });
    }
    return {
      rowsAccepted: stats.accepted,
      rowsRejected: 0,
      dateRange: { from: stats.minDate, to: stats.maxDate },
      format: "clearview_cash_sheet",
    };
  }

  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return {
      rowsAccepted: 0,
      rowsRejected: 0,
      dateRange: { from: null, to: null },
      format: "standard",
    };
  }

  const headers = Object.keys(records[0]);
  const format: SalesImportResult["format"] = isDropChartCsv(headers) ? "drop_chart" : "standard";

  let rejected = 0;
  const stats = { accepted: 0, minDate: null as string | null, maxDate: null as string | null };

  for (const record of records) {
    const parsed =
      format === "drop_chart" ? parseDropChartRecord(record) : parseStandardRecord(record);
    if (!parsed) {
      rejected++;
      continue;
    }
    await upsertSalesRow(workplaceId, parsed.date, parsed.hour, parsed.salesAmount, stats);
  }

  return {
    rowsAccepted: stats.accepted,
    rowsRejected: rejected,
    dateRange: { from: stats.minDate, to: stats.maxDate },
    format,
  };
}

/** Default product sales file: apps/ml-engine/drop_chart_all_days.csv */
export function defaultDropChartCsvPath(): string {
  return fileURLToPath(new URL("../../../ml-engine/drop_chart_all_days.csv", import.meta.url));
}
