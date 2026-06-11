import { describe, it, expect } from "vitest";
import {
  buildMlPredictions,
  buildSchedulingPreferences,
  peakPredictionsForPrompt,
  remapSalesDateToScheduleWeek,
} from "../src/services/llmInput.js";

describe("llmInput", () => {
  it("remaps sales dates onto the target schedule week by weekday", () => {
    expect(remapSalesDateToScheduleWeek("2026-05-25", "2026-06-01")).toBe("2026-06-01");
    expect(remapSalesDateToScheduleWeek("2026-05-31", "2026-06-01")).toBe("2026-06-07");
  });

  it("buildMlPredictions uses schedule week dates", () => {
    const preds = buildMlPredictions(
      [
        { date: "2026-05-25", hour: 12, sales: 200, workers: 2 },
        { date: "2026-05-25", hour: 18, sales: 500, workers: 4 },
      ],
      "2026-06-01"
    );
    expect(preds.every((p) => p.date === "2026-06-01")).toBe(true);
    expect(preds.some((p) => p.is_peak)).toBe(true);
  });

  it("peakPredictionsForPrompt caps and dedupes peaks", () => {
    const preds = Array.from({ length: 50 }, (_, i) => ({
      date: "2026-06-01",
      hour: i % 24,
      traffic_multiplier: 1 + i * 0.01,
      recommended: { cook: 1, cash: 1, pack: 1 },
      is_peak: true,
    }));
    expect(peakPredictionsForPrompt(preds, 10)).toHaveLength(10);
  });

  it("buildSchedulingPreferences supplies defaults when roleRequirements empty", () => {
    const prefs = buildSchedulingPreferences({
      labourCostPct: 0.2,
      constraints: { roleRequirements: {} },
    });
    expect(prefs.staffing_requirements.monday?.COOK?.min_count).toBe(1);
    expect(prefs.staffing_requirements.sunday?.PACKLINER?.min_count).toBe(1);
  });
});
