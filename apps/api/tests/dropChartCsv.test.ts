import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseDropChartDate,
  parseDropChartHour,
  isDropChartCsv,
  parseDropChartRecord,
} from "../src/services/dropChartCsv.js";
import { importSalesCsv } from "../src/services/csvImportService.js";
import { createApp } from "../src/app.js";
import request from "supertest";
import { signupEmployer } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dropChartPath = path.resolve(__dirname, "../../ml-engine/drop_chart_all_days.csv");

describe("drop chart csv", () => {
  it("parses date and hour from drop chart format", () => {
    expect(parseDropChartDate("April 20 2026")).toBe("2026-04-20");
    expect(parseDropChartHour("10:00 AM - 11:00 AM")).toBe(10);
    expect(parseDropChartHour("1:00 PM - 2:00 PM")).toBe(13);
    expect(parseDropChartHour("11:00 PM - 12:00 AM")).toBe(23);
  });

  it("detects drop chart headers", () => {
    expect(
      isDropChartCsv(["Day", "Date", "Total Sales ($)", "Time", "Sales ($)"])
    ).toBe(true);
    expect(isDropChartCsv(["date", "hour", "sales_amount"])).toBe(false);
  });

  it("imports drop_chart_all_days.csv via API", async () => {
    if (!fs.existsSync(dropChartPath)) {
      return;
    }
    const app = createApp();
    const { token, workplaceId } = await signupEmployer(app, "-dropchart");
    const buffer = fs.readFileSync(dropChartPath);

    const res = await request(app)
      .post(`/api/workplace/${workplaceId}/sales-data`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", buffer, "drop_chart_all_days.csv");

    expect(res.status).toBe(200);
    expect(res.body.format).toBe("drop_chart");
    expect(res.body.rowsAccepted).toBeGreaterThan(80);
    expect(res.body.rowsRejected).toBe(0);
    expect(res.body.dateRange.from).toBe("2026-04-20");
    expect(res.body.dateRange.to).toBe("2026-04-26");
  });

  it("parses a sample drop chart row", () => {
    const row = parseDropChartRecord({
      Day: "Monday",
      Date: "April 20 2026",
      "Total Sales ($)": "8565.87",
      Time: "6:00 PM - 7:00 PM",
      "Sales ($)": "1283.13",
    });
    expect(row).toEqual({ date: "2026-04-20", hour: 18, salesAmount: 1283.13 });
  });
});
