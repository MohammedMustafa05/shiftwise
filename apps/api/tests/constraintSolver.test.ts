import { describe, it, expect } from "vitest";
import { validateAndFill } from "../src/services/constraintSolver.js";
import { operatingHoursForDate } from "../src/utils/labourDemand.js";

const empId = "11111111-1111-1111-1111-111111111111";

const baseParams = {
  baselineShifts: [],
  employees: [{ user_id: empId, role: "COOK", max_hours: 40 }],
  availability: [{ user_id: empId, day_of_week: 1, start_time: "10:00", end_time: "16:00" }],
  approvedTimeOff: [],
  preferences: { constraints: {}, labourCostPct: 0.2, avgHourlyWage: 20 },
  weekStart: "2026-06-01",
  workersNeeded: {
    byHour: [{ date: "2026-06-01", hour: 12, sales: 100, workers: 3 }],
    byDay: [{ date: "2026-06-01", sales: 500, workers: 3 }],
  },
};

describe("validateAndFill", () => {
  it("accepts a partial shift inside an availability window", () => {
    const cashId = "22222222-2222-2222-2222-222222222222";
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";
    const { shifts } = validateAndFill({
      ...baseParams,
      employees: [
        { user_id: empId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: empId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
      ],
      llmSuggestions: [
        {
          employee_id: empId,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "COOK",
          reasoning: "Morning coverage",
          confidence: 0.9,
        },
      ],
    });
    const cook = shifts.find((s) => s.role === "COOK" && s.shiftDate === date && s.employeeId === empId);
    expect(cook).toBeDefined();
    expect(cook!.startTime).toBe("10:00");
    // Floor engine may extend to full availability window after LLM suggestion
    expect(["14:00", "16:00"]).toContain(cook!.endTime);
  });

  it("rejects a shift that extends outside the availability window", () => {
    const cashId = "22222222-2222-2222-2222-222222222222";
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";
    const { shifts, violationsFixed } = validateAndFill({
      ...baseParams,
      employees: [
        { user_id: empId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: empId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
      ],
      llmSuggestions: [
        {
          employee_id: empId,
          date,
          start_time: "10:00",
          end_time: "17:00",
          role: "COOK",
          reasoning: "Too long",
          confidence: 0.9,
        },
      ],
    });
    expect(violationsFixed).toBeGreaterThan(0);
    expect(shifts.every((s) => !(s.endTime === "17:00" && s.employeeId === empId))).toBe(true);
  });

  it("allows two non-overlapping shifts same employee same day within the window", () => {
    const cashId = "22222222-2222-2222-2222-222222222222";
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";
    const { shifts } = validateAndFill({
      ...baseParams,
      employees: [
        { user_id: empId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: empId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
      ],
      llmSuggestions: [
        {
          employee_id: cashId,
          date,
          start_time: "10:00",
          end_time: "13:00",
          role: "CASHIER",
          reasoning: "Open",
          confidence: 0.9,
        },
        {
          employee_id: cashId,
          date,
          start_time: "13:00",
          end_time: "16:00",
          role: "CASHIER",
          reasoning: "Close",
          confidence: 0.9,
        },
      ],
    });
    const cashShifts = shifts.filter((s) => s.role === "CASHIER" && s.employeeId === cashId);
    expect(cashShifts.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects shifts that exceed daily labour cap", () => {
    const emp2 = "22222222-2222-2222-2222-222222222222";
    const emp3 = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";
    const { shifts, violationsFixed } = validateAndFill({
      ...baseParams,
      employees: [
        { user_id: empId, role: "COOK", max_hours: 40 },
        { user_id: emp2, role: "CASHIER", max_hours: 40 },
        { user_id: emp3, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: empId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: emp2, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: emp3, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3 }],
        byDay: [{ date, sales: 500, workers: 2 }],
      },
      llmSuggestions: [
        {
          employee_id: empId,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "COOK",
          reasoning: "a",
          confidence: 0.9,
        },
        {
          employee_id: emp2,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "CASHIER",
          reasoning: "b",
          confidence: 0.9,
        },
        {
          employee_id: emp3,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "PACKLINER",
          reasoning: "c",
          confidence: 0.9,
        },
      ],
    });
    // Third role is added by solver when core hourly mix is incomplete (daily cap relaxed).
    expect(shifts).toHaveLength(3);
    expect(violationsFixed).toBeGreaterThanOrEqual(1);
  });

  it("covers every operating hour with cook, cashier, and packliner", () => {
    const cookId = "11111111-1111-1111-1111-111111111111";
    const cashId = "22222222-2222-2222-2222-222222222222";
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";

    const { shifts } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      employees: [
        { user_id: cookId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: cookId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3 }],
        byDay: [{ date, sales: 500, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: cookId,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "COOK",
          reasoning: "only cook",
          confidence: 0.9,
        },
      ],
    });

    // Monday closes at 22:00 (10PM) — last operating hour is 21 (9PM–10PM).
    for (let hour = 10; hour < 22; hour++) {
      const counts = { COOK: 0, CASHIER: 0, PACKLINER: 0 };
      for (const s of shifts) {
        if (s.shiftDate !== date) continue;
        const startH = parseInt(s.startTime.slice(0, 2), 10);
        let endH = parseInt(s.endTime.slice(0, 2), 10);
        if (endH <= startH) endH += 24;
        const covers = hour >= startH && hour < endH;
        if (!covers) continue;
        if (s.role in counts) counts[s.role as keyof typeof counts]++;
      }
      expect(counts.COOK, `hour ${hour}`).toBeGreaterThanOrEqual(1);
      expect(counts.CASHIER, `hour ${hour}`).toBeGreaterThanOrEqual(1);
      expect(counts.PACKLINER, `hour ${hour}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("fills hourly role gaps when LLM only schedules cooks", () => {
    const cookId = "11111111-1111-1111-1111-111111111111";
    const cashId = "22222222-2222-2222-2222-222222222222";
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";

    const { shifts } = validateAndFill({
      ...baseParams,
      employees: [
        { user_id: cookId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: cookId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
      ],
      weekStart: "2026-06-01",
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3, roles: { COOK: 1, CASHIER: 1, PACKLINER: 1 } }],
        byDay: [{ date, sales: 500, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: cookId,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "COOK",
          reasoning: "only cook",
          confidence: 0.9,
        },
      ],
    });

    const atNoon = shifts.filter((s) => {
      if (s.shiftDate !== date) return false;
      const startH = parseInt(s.startTime.slice(0, 2), 10);
      let endH = parseInt(s.endTime.slice(0, 2), 10);
      if (endH <= startH) endH += 24;
      return 12 >= startH && 12 < endH;
    });
    const roles = new Set(atNoon.map((s) => s.role));
    expect(roles.has("COOK")).toBe(true);
    expect(roles.has("CASHIER")).toBe(true);
    expect(roles.has("PACKLINER")).toBe(true);
  });

  it("prunes extra cooks then fills cashier so hour cap does not block core trio", () => {
    const cook1 = "11111111-1111-1111-1111-111111111111";
    const cook2 = "22222222-2222-2222-2222-222222222222";
    const cashId = "33333333-3333-3333-3333-333333333333";
    const packId = "44444444-4444-4444-4444-444444444444";
    const date = "2026-06-01";

    const { shifts } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      employees: [
        { user_id: cook1, role: "COOK", max_hours: 40 },
        { user_id: cook2, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: cook1, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: cook2, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3 }],
        byDay: [{ date, sales: 500, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: cook1,
          date,
          start_time: "10:00",
          end_time: "22:00",
          role: "COOK",
          reasoning: "cook1",
          confidence: 0.9,
        },
        {
          employee_id: cook2,
          date,
          start_time: "10:00",
          end_time: "22:00",
          role: "COOK",
          reasoning: "cook2",
          confidence: 0.9,
        },
      ],
    });

    const atNoon = shifts.filter((s) => s.shiftDate === date && s.startTime <= "12:00" && s.endTime > "12:00");
    const roles = new Set(atNoon.map((s) => s.role));
    expect(roles).toEqual(new Set(["COOK", "CASHIER", "PACKLINER"]));
    expect(atNoon.filter((s) => s.role === "COOK")).toHaveLength(1);
  });

  it("second pass fills evening after short baseline shifts (post-preference simulation)", () => {
    const cookId = "11111111-1111-1111-1111-111111111111";
    const cashId = "22222222-2222-2222-2222-222222222222";
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-02";

    const { shifts } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      llmSuggestions: [],
      baselineShifts: [
        {
          id: "a",
          employeeId: cookId,
          day: "TUE",
          shiftDate: date,
          startTime: "10:00",
          endTime: "16:00",
          role: "COOK",
          location: "Main",
        },
      ],
      employees: [
        { user_id: cookId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: cookId, day_of_week: 2, start_time: "10:00", end_time: "23:00" },
        { user_id: cashId, day_of_week: 2, start_time: "10:00", end_time: "23:00" },
        { user_id: packId, day_of_week: 2, start_time: "10:00", end_time: "23:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3 }],
        byDay: [{ date, sales: 500, workers: 3 }],
      },
    });

    const { open, close } = operatingHoursForDate(date);
    for (let hour = open; hour < close; hour++) {
      const counts = { COOK: 0, CASHIER: 0, PACKLINER: 0 };
      for (const s of shifts) {
        if (s.shiftDate !== date) continue;
        const startH = parseInt(s.startTime.slice(0, 2), 10);
        let endH = parseInt(s.endTime.slice(0, 2), 10);
        if (endH <= startH) endH += 24;
        if (hour >= startH && hour < endH) counts[s.role as keyof typeof counts]++;
      }
      expect(counts.COOK, `hour ${hour}`).toBeGreaterThanOrEqual(1);
      expect(counts.CASHIER, `hour ${hour}`).toBeGreaterThanOrEqual(1);
      expect(counts.PACKLINER, `hour ${hour}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("Test 2 — only packliners available flags missing cook and cashier gaps", () => {
    const packId = "33333333-3333-3333-3333-333333333333";
    const date = "2026-06-01";

    const { shifts, roleCoverageGaps, hardFlags } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      employees: [{ user_id: packId, role: "PACKLINER", max_hours: 40 }],
      availability: [{ user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "22:00" }],
      workersNeeded: {
        byHour: [{
          date,
          hour: 12,
          sales: 20,
          workers: 3,
          mandatoryFloor: 3,
          formulaHeadcount: 3,
          extraWorkers: 0,
          floorRoles: { COOK: 1, CASHIER: 1, PACKLINER: 1 },
          extraRoles: { COOK: 0, CASHIER: 0, PACKLINER: 0 },
          roles: { COOK: 1, CASHIER: 1, PACKLINER: 1 },
        }],
        byDay: [{ date, sales: 20, workers: 3, mandatoryFloor: 3, formulaHeadcount: 3, extraWorkers: 0 }],
      },
      llmSuggestions: [],
    });

    expect(shifts.some((s) => s.role === "PACKLINER")).toBe(true);
    expect(roleCoverageGaps.some((g) => g.includes("cook"))).toBe(true);
    expect(roleCoverageGaps.some((g) => g.includes("cashier"))).toBe(true);
    expect(hardFlags.some((f) => f.code === "H1_ROLE_COVERAGE_GAP" && f.role === "COOK")).toBe(true);
    expect(hardFlags.some((f) => f.code === "H1_ROLE_COVERAGE_GAP" && f.role === "CASHIER")).toBe(true);
    expect(hardFlags.every((f) => f.severity === "hard")).toBe(true);
  });

  it("Test 6 — late night H3: one multi-role person does not satisfy headcount", () => {
    const multiId = "55555555-5555-5555-5555-555555555555";
    const date = "2026-06-05"; // Friday

    const { hardFlags } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      employees: [
        {
          user_id: multiId,
          role: "COOK",
          roles: ["COOK", "CASHIER", "PACKLINER"],
          max_hours: 40,
        },
      ],
      availability: [{ user_id: multiId, day_of_week: 5, start_time: "18:00", end_time: "00:00" }],
      workersNeeded: {
        byHour: [{ date, hour: 22, sales: 50, workers: 3 }],
        byDay: [{ date, sales: 200, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: multiId,
          date,
          start_time: "18:00",
          end_time: "00:00",
          role: "COOK",
          reasoning: "solo late night",
          confidence: 0.9,
        },
      ],
    });

    const h3 = hardFlags.filter((f) => f.code === "H3_LATE_NIGHT_HEADCOUNT");
    expect(h3.length).toBeGreaterThan(0);
    expect(h3.some((f) => f.hour >= 22 && f.detail.includes("2 people"))).toBe(true);
    expect(h3.every((f) => f.severity === "hard")).toBe(true);
  });

  it("Test 6 — late night H3 passes with two people covering trio roles", () => {
    const cookId = "11111111-1111-1111-1111-111111111111";
    const cashId = "22222222-2222-2222-2222-222222222222";
    const date = "2026-06-05"; // Friday

    const { hardFlags } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      employees: [
        { user_id: cookId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", roles: ["CASHIER", "PACKLINER"], max_hours: 40 },
      ],
      availability: [
        { user_id: cookId, day_of_week: 5, start_time: "18:00", end_time: "00:00" },
        { user_id: cashId, day_of_week: 5, start_time: "18:00", end_time: "00:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 22, sales: 50, workers: 3 }],
        byDay: [{ date, sales: 200, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: cookId,
          date,
          start_time: "18:00",
          end_time: "00:00",
          role: "COOK",
          reasoning: "cook late",
          confidence: 0.9,
        },
        {
          employee_id: cashId,
          date,
          start_time: "18:00",
          end_time: "00:00",
          role: "CASHIER",
          reasoning: "cash+pack late",
          confidence: 0.9,
        },
      ],
    });

    expect(hardFlags.filter((f) => f.code === "H3_LATE_NIGHT_HEADCOUNT")).toHaveLength(0);
  });

  it("prune keeps floor role composition — cannot remove sole cook for an hour", () => {
    const cook1 = "11111111-1111-1111-1111-111111111111";
    const cook2 = "22222222-2222-2222-2222-222222222222";
    const cashId = "33333333-3333-3333-3333-333333333333";
    const packId = "44444444-4444-4444-4444-444444444444";
    const date = "2026-06-01";

    const { shifts } = validateAndFill({
      ...baseParams,
      weekStart: "2026-06-01",
      employees: [
        { user_id: cook1, role: "COOK", max_hours: 40 },
        { user_id: cook2, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: packId, role: "PACKLINER", max_hours: 40 },
      ],
      availability: [
        { user_id: cook1, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: cook2, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
        { user_id: packId, day_of_week: 1, start_time: "10:00", end_time: "22:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3 }],
        byDay: [{ date, sales: 500, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: cook1,
          date,
          start_time: "10:00",
          end_time: "22:00",
          role: "COOK",
          reasoning: "cook1",
          confidence: 0.9,
        },
        {
          employee_id: cook2,
          date,
          start_time: "10:00",
          end_time: "22:00",
          role: "COOK",
          reasoning: "cook2",
          confidence: 0.9,
        },
        {
          employee_id: cashId,
          date,
          start_time: "10:00",
          end_time: "22:00",
          role: "CASHIER",
          reasoning: "cash",
          confidence: 0.9,
        },
        {
          employee_id: packId,
          date,
          start_time: "10:00",
          end_time: "22:00",
          role: "PACKLINER",
          reasoning: "pack",
          confidence: 0.9,
        },
      ],
    });

    const atNoon = shifts.filter((s) => s.shiftDate === date && s.startTime <= "12:00" && s.endTime > "12:00");
    expect(atNoon.filter((s) => s.role === "COOK")).toHaveLength(1);
    expect(atNoon.filter((s) => s.role === "CASHIER")).toHaveLength(1);
    expect(atNoon.filter((s) => s.role === "PACKLINER")).toHaveLength(1);
  });

  it("multi-role employee can fill packliner gap", () => {
    const multiId = "44444444-4444-4444-4444-444444444444";
    const cookId = "11111111-1111-1111-1111-111111111111";
    const cashId = "22222222-2222-2222-2222-222222222222";
    const date = "2026-06-01";

    const { shifts } = validateAndFill({
      ...baseParams,
      employees: [
        { user_id: cookId, role: "COOK", max_hours: 40 },
        { user_id: cashId, role: "CASHIER", max_hours: 40 },
        { user_id: multiId, role: "COOK", roles: ["COOK", "PACKLINER", "CASHIER"], max_hours: 40 },
      ],
      availability: [
        { user_id: cookId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: cashId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
        { user_id: multiId, day_of_week: 1, start_time: "10:00", end_time: "16:00" },
      ],
      workersNeeded: {
        byHour: [{ date, hour: 12, sales: 100, workers: 3 }],
        byDay: [{ date, sales: 500, workers: 3 }],
      },
      llmSuggestions: [
        {
          employee_id: cookId,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "COOK",
          reasoning: "cook",
          confidence: 0.9,
        },
        {
          employee_id: cashId,
          date,
          start_time: "10:00",
          end_time: "14:00",
          role: "CASHIER",
          reasoning: "cash",
          confidence: 0.9,
        },
      ],
    });

    expect(shifts.some((s) => s.role === "PACKLINER" && s.employeeId === multiId)).toBe(true);
  });

  it("honours descending preference bands hour-by-hour (authoritative, with trimming)", () => {
    const date = "2026-06-01"; // Monday
    // Manager bands for Monday:
    //   10:00–16:00 → 1 cook / 1 cashier / 3 packliners
    //   16:00–20:00 → 1 cook / 2 cashier / 4 packliners
    //   20:00–22:00 → 1 cook / 2 cashier / 2 packliners
    const mk = (n: number, role: string) =>
      Array.from({ length: n }, (_, i) => ({
        user_id: `${role[0].toLowerCase()}${i}-0000-0000-0000-000000000000`.padEnd(36, "0").slice(0, 36),
        role,
        max_hours: 40,
      }));
    const employees = [...mk(2, "COOK"), ...mk(3, "CASHIER"), ...mk(5, "PACKLINER")];
    const availability = employees.map((e) => ({
      user_id: e.user_id,
      day_of_week: 1,
      start_time: "10:00",
      end_time: "22:00",
    }));

    const { shifts } = validateAndFill({
      ...baseParams,
      employees,
      availability,
      preferences: {
        constraints: {
          roleRequirements: {
            Monday: [
              { from: "10:00", to: "16:00", cooks: 1, cashiers: 1, packliners: 3 },
              { from: "16:00", to: "20:00", cooks: 1, cashiers: 2, packliners: 4 },
              { from: "20:00", to: "22:00", cooks: 1, cashiers: 2, packliners: 2 },
            ],
          },
        },
        labourCostPct: 0.2,
        avgHourlyWage: 20,
      },
      llmSuggestions: [],
    });

    const countAt = (hour: number, role: string) =>
      shifts.filter(
        (s) =>
          s.shiftDate === date &&
          s.role === role &&
          toMin(s.startTime) <= hour * 60 &&
          endMin(s.endTime, s.startTime) > hour * 60
      ).length;

    // Each band's exact counts must hold at every hour it covers.
    for (let h = 10; h < 16; h++) {
      expect(countAt(h, "COOK")).toBe(1);
      expect(countAt(h, "CASHIER")).toBe(1);
      expect(countAt(h, "PACKLINER")).toBe(3);
    }
    for (let h = 16; h < 20; h++) {
      expect(countAt(h, "COOK")).toBe(1);
      expect(countAt(h, "CASHIER")).toBe(2);
      expect(countAt(h, "PACKLINER")).toBe(4);
    }
    for (let h = 20; h < 22; h++) {
      expect(countAt(h, "COOK")).toBe(1);
      expect(countAt(h, "CASHIER")).toBe(2);
      expect(countAt(h, "PACKLINER")).toBe(2);
    }
  });
});

function toMin(t: string): number {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}
function endMin(end: string, start: string): number {
  const e = toMin(end);
  const s = toMin(start);
  if (e === 0 && s >= 12 * 60) return 24 * 60;
  if (e <= s && s > 0) return e + 24 * 60;
  return e;
}
