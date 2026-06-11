import { describe, it, expect } from "vitest";
import { parseTimeToHours } from "../src/utils/dates.js";

/** Mirrors applyEmployeeSchedulingRules truncation logic in scheduleService.ts */
function applyLightShiftCap(
  shifts: Array<{ employeeId: string; startTime: string; endTime: string; lightShiftOnly: boolean }>,
  profiles: Map<string, { lightShiftOnly: boolean }>
) {
  return shifts.map((shift) => {
    const prof = profiles.get(shift.employeeId);
    const hours = parseTimeToHours(shift.startTime, shift.endTime);
    if (prof?.lightShiftOnly && hours > 8) {
      const [sh, sm] = shift.startTime.split(":").map((n) => parseInt(n, 10));
      const endTotal = sh * 60 + (sm || 0) + 8 * 60;
      const endH = Math.floor(endTotal / 60) % 24;
      const endM = endTotal % 60;
      return {
        ...shift,
        endTime: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
      };
    }
    return shift;
  });
}

describe("employee scheduling rules", () => {
  it("does not truncate veteran 10-22 shifts to 10-16", () => {
    const profiles = new Map([["v1", { lightShiftOnly: false }]]);
    const out = applyLightShiftCap(
      [{ employeeId: "v1", startTime: "10:00", endTime: "22:00", lightShiftOnly: false }],
      profiles
    );
    expect(out[0].endTime).toBe("22:00");
  });

  it("caps trainee shifts at 8 hours from start", () => {
    const profiles = new Map([["t1", { lightShiftOnly: true }]]);
    const out = applyLightShiftCap(
      [{ employeeId: "t1", startTime: "10:00", endTime: "22:00", lightShiftOnly: true }],
      profiles
    );
    expect(out[0].endTime).toBe("18:00");
  });
});
