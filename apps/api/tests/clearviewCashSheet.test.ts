import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  formatShiftTime,
  formatTimeClearview,
  formatEmployeeDisplayName,
  formatShiftCellLabel,
  formatRoleLabel,
} from "../src/services/scheduleExporter.js";
import {
  dailyTotal,
  isClearviewCashSheetBuffer,
  isClearviewCashSheetCsvBuffer,
  parseClearviewCashSheetBuffer,
  parseTimeToHour,
  resolveTotalColumns,
} from "../src/services/clearviewCashSheet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleXls = path.resolve(__dirname, "../../ml-engine/hourly sales data/Cash Sheet - Hourly Sales (22).xls");
const sampleCsv = path.resolve(__dirname, "../../ml-engine/hourly sales data/Cash Sheet - Hourly Sales (37).csv");

describe("clearviewCashSheet", () => {
  it("parses UTF-16 LE Clearview cash sheet and reads column 18 total sales", () => {
    if (!fs.existsSync(sampleXls)) return;
    const buffer = fs.readFileSync(sampleXls);
    expect(isClearviewCashSheetBuffer(buffer)).toBe(true);
    const records = parseClearviewCashSheetBuffer(buffer);
    expect(records.length).toBe(13);
    expect(records[0].hour_start).toBe(11);
    expect(records[0].hour).toBe(11);
    expect(records[0].total_sales).toBeCloseTo(87.94, 1);
    expect(records[records.length - 1].hour_start).toBe(23);
  });

  it("parses UTF-8 CSV cash sheet using ncols-3 total sales column", () => {
    if (!fs.existsSync(sampleCsv)) return;
    const buffer = fs.readFileSync(sampleCsv);
    expect(isClearviewCashSheetCsvBuffer(buffer)).toBe(true);
    expect(isClearviewCashSheetBuffer(buffer)).toBe(true);
    const records = parseClearviewCashSheetBuffer(buffer);
    expect(records.length).toBeGreaterThanOrEqual(13);
    expect(records[0].hour).toBe(10);
    expect(dailyTotal(records)).toBeCloseTo(4861.41, 0);
  });

  it("resolves total column indices for XLS and CSV layouts", () => {
    expect(resolveTotalColumns(21, false)).toEqual({ salesCol: 18, countCol: 17 });
    expect(resolveTotalColumns(27, true)).toEqual({ salesCol: 24, countCol: 23 });
  });

  it("converts Clearview time strings to 24h hours", () => {
    expect(parseTimeToHour("10:00 AM")).toBe(10);
    expect(parseTimeToHour("12:00 PM")).toBe(12);
    expect(parseTimeToHour("1:00 PM")).toBe(13);
    expect(parseTimeToHour("10:00 PM")).toBe(22);
    expect(parseTimeToHour("11:00 PM")).toBe(23);
  });
});

describe("scheduleExporter formatting", () => {
  it("formats shift times in Clearview style", () => {
    expect(formatShiftTime("10:00", "22:00")).toBe("10AM - 10PM");
    expect(formatShiftTime("10:30", "22:00")).toBe("10:30AM - 10PM");
    expect(formatTimeClearview("17:00")).toBe("5PM");
    expect(formatShiftCellLabel("10:00", "16:00", "COOK")).toBe("10AM - 4PM Cook");
    expect(formatRoleLabel("PACKLINER")).toBe("Packliner");
  });

  it("formats employee names First L.", () => {
    expect(formatEmployeeDisplayName("Ghanva Ali")).toBe("Ghanva A.");
    expect(formatEmployeeDisplayName("Kazim")).toBe("Kazim");
  });
});
