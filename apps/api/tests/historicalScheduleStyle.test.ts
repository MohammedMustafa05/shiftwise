import { describe, it, expect } from "vitest";
import {
  allHistoricalShifts,
  buildHistoricalStylePromptLines,
  bestShiftWindowForHour,
  loadHistoricalFixture,
} from "../src/services/historicalScheduleStyle.js";

describe("historicalScheduleStyle", () => {
  it("loads LSL fixture with parsed Clearview weeks", () => {
    const fixture = loadHistoricalFixture();
    expect(fixture).not.toBeNull();
    expect(fixture!.weeks.length).toBeGreaterThanOrEqual(2);
    expect(allHistoricalShifts().length).toBeGreaterThan(50);
  });

  it("builds prompt lines with open/close crew guidance", () => {
    const lines = buildHistoricalStylePromptLines(["Kazim", "Pankaj", "Inaya"]);
    expect(lines.some((l) => l.includes("HISTORICAL LSL"))).toBe(true);
    expect(lines.some((l) => l.includes("10:00–17:00"))).toBe(true);
    expect(lines.some((l) => l.includes("Kazim:"))).toBe(true);
  });

  it("prefers close window for evening hour gaps", () => {
    const win = bestShiftWindowForHour("15:00", "22:00", 18);
    expect(win).toEqual({ start: "17:00", end: "22:00" });
  });

  it("prefers open window for midday hour gaps", () => {
    const win = bestShiftWindowForHour("10:00", "22:00", 12);
    expect(win).toEqual({ start: "10:00", end: "17:00" });
  });
});
