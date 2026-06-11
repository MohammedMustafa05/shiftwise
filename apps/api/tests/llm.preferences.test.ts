import { describe, it, expect, beforeEach } from "vitest";
import { query } from "../src/db/pool.js";
import {
  extractAIMistakePatterns,
  extractManagerPreferences,
  processNewOverride,
} from "../src/services/preferenceExtractor.js";

async function makeWorkplace(slug: string): Promise<string> {
  const wp = await query<{ id: string }>(
    `INSERT INTO workplaces (name, slug, timezone) VALUES ($1, $2, 'America/Toronto') RETURNING id`,
    ["Test", slug]
  );
  return wp.rows[0].id;
}

const empA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const empB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function override(workplaceId: string, reason: string) {
  return processNewOverride({
    workplaceId,
    overrideReason: reason,
    originalEmployeeId: empA,
    newEmployeeId: empB,
    shiftDate: "2026-06-05",
    dayOfWeek: 5,
    startTime: "18:00",
    endTime: "22:00",
    role: "COOK",
  });
}

describe("preferenceExtractor", () => {
  it("does not learn from one_time_exception edits", async () => {
    const wp = await makeWorkplace("pref-exception");
    await override(wp, "one_time_exception");
    const prefs = await extractManagerPreferences(wp);
    expect(prefs).toHaveLength(0);
  });

  it("learns from new_permanent_preference and surfaces it", async () => {
    const wp = await makeWorkplace("pref-permanent");
    await override(wp, "new_permanent_preference");
    const prefs = await extractManagerPreferences(wp);
    expect(prefs).toHaveLength(1);
    expect(prefs[0].pattern_type).toBe("employee_shift_preference");
    expect(prefs[0].confidence_score).toBeCloseTo(0.4, 2);
  });

  it("strengthens confidence and count when the same pattern repeats", async () => {
    const wp = await makeWorkplace("pref-repeat");
    await override(wp, "new_permanent_preference");
    await override(wp, "new_permanent_preference");

    const rows = await query<{ times_observed: number; confidence_score: string }>(
      `SELECT times_observed, confidence_score FROM manager_preferences WHERE workplace_id = $1`,
      [wp]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].times_observed).toBe(2);
    expect(Number(rows.rows[0].confidence_score)).toBeCloseTo(0.55, 2);
  });

  it("learns from fixing_ai_mistake as mistake pattern", async () => {
    const wp = await makeWorkplace("pref-mistake");
    await override(wp, "fixing_ai_mistake");
    const mistakes = await extractAIMistakePatterns(wp);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].pattern_type).toBe("ai_mistake_pattern");
    const prefs = await extractManagerPreferences(wp);
    expect(prefs).toHaveLength(0);
  });
});
