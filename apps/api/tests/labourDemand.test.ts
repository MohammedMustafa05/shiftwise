import { describe, it, expect } from "vitest";
import {
  AVG_WAGE,
  LABOUR_COST_PCT,
  MANDATORY_FLOOR,
  MAX_ROLE_STAFF,
  combinedRoleTargets,
  computeWorkersNeeded,
  extraRoleTargets,
  extraWorkersFromFormula,
  formulaHeadcountFromSales,
  operatingHoursForDate,
  pythonWeekdayFromDate,
  roleTargetsForTotalWorkers,
  workersNeededFromSales,
  buildHourlyDemand,
  buildDailyDemandFromHourly,
} from "../src/utils/labourDemand.js";

describe("labourDemand — Store 6412 Milton LSL", () => {
  it("Test 1 — low sales hour still gets floor of 3, zero extras", () => {
    expect(formulaHeadcountFromSales(43.15, LABOUR_COST_PCT, AVG_WAGE)).toBe(MANDATORY_FLOOR);
    expect(extraWorkersFromFormula(3)).toBe(0);
  });

  it("spot checks from manual session", () => {
    const cases: Array<[number, number, number, number, number]> = [
      [43.15, 3, 1, 1, 1],
      [350, 4, 1, 2, 1],
      [496.87, 5, 1, 2, 2],
      [728.53, 7, 1, 3, 3],
      [1283.13, 13, 1, 3, 3],
    ];
    for (const [sales, total, cook, pack, cash] of cases) {
      const r = computeWorkersNeeded(sales);
      expect(r.total).toBe(total);
      expect(r.cook).toBe(cook);
      expect(r.pack).toBe(pack);
      expect(r.cash).toBe(cash);
      if (total > MAX_ROLE_STAFF) expect(r.overdemand).toBe(true);
    }
  });

  it("Test 3 — busy hour adds extras above floor", () => {
    const formula = formulaHeadcountFromSales(500, LABOUR_COST_PCT, AVG_WAGE);
    expect(formula).toBe(5);
    expect(extraWorkersFromFormula(formula)).toBe(2);
    expect(combinedRoleTargets(formula)).toEqual({ COOK: 1, CASHIER: 2, PACKLINER: 2 });
  });

  it("uses (sales × 20%) / $20 with minimum 3", () => {
    expect(workersNeededFromSales(0)).toBe(MANDATORY_FLOOR);
    expect(workersNeededFromSales(400)).toBe(4);
    expect(workersNeededFromSales(500)).toBe(5);
  });

  it("role targets: Pack → Cash alternation", () => {
    expect(combinedRoleTargets(3)).toEqual({ COOK: 1, CASHIER: 1, PACKLINER: 1 });
    expect(combinedRoleTargets(4)).toEqual({ COOK: 1, CASHIER: 1, PACKLINER: 2 });
    expect(combinedRoleTargets(5)).toEqual({ COOK: 1, CASHIER: 2, PACKLINER: 2 });
    expect(combinedRoleTargets(6)).toEqual({ COOK: 1, CASHIER: 2, PACKLINER: 3 });
    expect(combinedRoleTargets(7)).toEqual({ COOK: 1, CASHIER: 3, PACKLINER: 3 });
    expect(extraRoleTargets(4)).toEqual({ COOK: 0, CASHIER: 2, PACKLINER: 2 });
    expect(roleTargetsForTotalWorkers(7)).toEqual({ COOK: 1, CASHIER: 3, PACKLINER: 3 });
  });

  it("operating hours vary by day of week", () => {
    expect(pythonWeekdayFromDate("2026-04-20")).toBe(0); // Monday
    // Weeknights close at 10PM (22); Mon/Wed Drop Chart 10PM–11PM slots are stragglers.
    expect(operatingHoursForDate("2026-04-20")).toEqual({ open: 10, close: 22 });
    expect(operatingHoursForDate("2026-04-24")).toEqual({ open: 10, close: 24 });
    expect(operatingHoursForDate("2026-04-25")).toEqual({ open: 11, close: 24 });
    expect(operatingHoursForDate("2026-04-26")).toEqual({ open: 11, close: 22 });
  });

  it("buildHourlyDemand attaches floor + extra breakdown", () => {
    const byHour = buildHourlyDemand([{ date: "2026-06-01", hour: 12, salesAmount: 500 }]);
    expect(byHour[0].mandatoryFloor).toBe(3);
    expect(byHour[0].extraWorkers).toBe(2);
    expect(byHour[0].roles).toEqual({ COOK: 1, CASHIER: 2, PACKLINER: 2 });
  });

  it("builds daily demand from total sales, not sum of hourly caps", () => {
    const byHour = buildHourlyDemand([
      { date: "2026-06-01", hour: 11, salesAmount: 200 },
      { date: "2026-06-01", hour: 12, salesAmount: 300 },
    ]);
    const byDay = buildDailyDemandFromHourly(byHour);
    expect(byDay).toHaveLength(1);
    expect(byDay[0].sales).toBe(500);
    expect(byDay[0].workers).toBe(workersNeededFromSales(500));
  });
});
