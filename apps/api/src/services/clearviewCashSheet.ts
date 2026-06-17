/** Parse Clearview UTF-16 HTML-as-XLS and UTF-8 CSV hourly sales exports (Cash Sheet). */

export type ClearviewHourlyRecord = {
  hour: number;
  hour_start: number;
  hour_end: number;
  hour_label: string;
  total_sales: number;
  transaction_count: number;
};

export const DEFAULT_OPEN_HOUR = 10;
export const DEFAULT_CLOSE_HOUR = 23;

export const ANOMALY_DATES = new Set(["2026-04-20"]);

function decodeClearviewHtml(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return buffer.swap16().toString("utf16le");
  }
  try {
    return buffer.toString("utf8");
  } catch {
    return buffer.toString("latin1");
  }
}

function stripHtml(cell: string): string {
  return cell.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
}

function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      cells.push(stripHtml(tdMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

export function resolveTotalColumns(ncols: number, isCsv: boolean): { salesCol: number; countCol: number } {
  if (!isCsv && ncols === 21) {
    return { salesCol: 18, countCol: 17 };
  }
  return { salesCol: ncols - 3, countCol: ncols - 4 };
}

export function parseTimeToHour(timeStr: string): number | null {
  const m = timeStr.trim().toUpperCase().match(/^(\d+):(\d+)\s*(AM|PM)/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const ampm = m[3];
  if (ampm === "PM" && hour !== 12) hour += 12;
  else if (ampm === "AM" && hour === 12) hour = 0;
  return hour;
}

export function formatHourLabel(hour24: number): string {
  if (hour24 === 0) return "12:00 AM";
  if (hour24 < 12) return `${hour24}:00 AM`;
  if (hour24 === 12) return "12:00 PM";
  return `${hour24 - 12}:00 PM`;
}

export function isClearviewCashSheetCsvBuffer(buffer: Buffer): boolean {
  const head = buffer.slice(0, 4000).toString("utf8").toLowerCase();
  return (
    head.includes("show breakdown by destination") &&
    head.includes("from") &&
    (head.includes("take out") || head.includes("uber eats"))
  );
}

export function isClearviewCashSheetBuffer(buffer: Buffer): boolean {
  if (isClearviewCashSheetCsvBuffer(buffer)) return true;
  if (buffer.length < 4) return false;
  const isUtf16 =
    (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff);
  if (!isUtf16) return false;
  const html = decodeClearviewHtml(buffer).slice(0, 4000).toLowerCase();
  return (
    html.includes("<table") &&
    (html.includes("take out") || html.includes("uber eats") || html.includes("total"))
  );
}

function extractRecordsFromTable(rows: string[][], isCsv: boolean): ClearviewHourlyRecord[] {
  if (rows.length < 4) {
    throw new Error("No tables found in sales file");
  }

  const ncols = Math.max(...rows.map((r) => r.length));
  const { salesCol, countCol } = resolveTotalColumns(ncols, isCsv);
  const dataRows = rows.slice(2, -1);
  const records: ClearviewHourlyRecord[] = [];

  for (const row of dataRows) {
    if (row.length < 2) continue;
    const startStr = row[0]?.trim() ?? "";
    const endStr = row[1]?.trim() ?? "";
    if (!startStr || ["nan", "from", "totals", "total"].includes(startStr.toLowerCase())) continue;
    if (!/\d+:\d+/.test(startStr)) continue;

    const hourStart = parseTimeToHour(startStr);
    const hourEnd = parseTimeToHour(endStr);
    if (hourStart === null) continue;
    if (hourStart === 0) continue;

    const salesRaw = row[salesCol]?.replace(/[$,]/g, "").trim() ?? "0";
    let totalSales = parseFloat(salesRaw);
    if (Number.isNaN(totalSales) || totalSales < 0) totalSales = 0;

    const countRaw = row[countCol]?.replace(/[$,]/g, "").trim() ?? "0";
    let transactionCount = parseInt(countRaw, 10);
    if (Number.isNaN(transactionCount)) transactionCount = 0;

    const endHour = hourEnd ?? hourStart + 1;
    records.push({
      hour: hourStart,
      hour_start: hourStart,
      hour_end: endHour,
      hour_label: `${formatHourLabel(hourStart)} - ${formatHourLabel(endHour)}`,
      total_sales: Math.round(totalSales * 100) / 100,
      transaction_count: transactionCount,
    });
  }

  if (records.length === 0) {
    throw new Error("No valid hourly data rows found in Clearview cash sheet");
  }

  records.sort((a, b) => a.hour - b.hour);
  return records;
}

export function parseClearviewCashSheetBuffer(buffer: Buffer): ClearviewHourlyRecord[] {
  if (isClearviewCashSheetCsvBuffer(buffer)) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    return extractRecordsFromTable(parseCsvRows(text), true);
  }

  const html = decodeClearviewHtml(buffer);
  return extractRecordsFromTable(parseHtmlTable(html), false);
}

export function getOperatingHours(records: ClearviewHourlyRecord[]): { open: number; close: number } {
  if (records.length === 0) return { open: DEFAULT_OPEN_HOUR, close: DEFAULT_CLOSE_HOUR };
  return { open: records[0].hour_start, close: records[records.length - 1].hour_end };
}

export function dailyTotal(records: ClearviewHourlyRecord[]): number {
  return Math.round(records.reduce((sum, r) => sum + r.total_sales, 0) * 100) / 100;
}

export function dayOfWeekFromDate(saleDate: string): number {
  const d = new Date(`${saleDate}T12:00:00`);
  // JS: 0=Sun — convert to ISO Mon=0
  return (d.getDay() + 6) % 7;
}

export function isAnomalyDate(saleDate: string): boolean {
  return ANOMALY_DATES.has(saleDate);
}
