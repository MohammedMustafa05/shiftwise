import { describe, it, expect } from "vitest";
import type { LLMPlannerInput } from "@shiftagent/shared";
import { buildSystemPrompt, buildUserMessage } from "../src/lib/llm/promptBuilder.js";

function baseInput(overrides: Partial<LLMPlannerInput> = {}): LLMPlannerInput {
  return {
    workplace_id: "wp-1",
    week_start: "2026-06-01",
    scheduling_preferences: {
      staffing_requirements: {},
      max_weekly_hours: 45,
      max_hours_per_employee: 45,
      overtime_threshold: 40,
      overtime_rules: "FLAG_ONLY",
      rush_hour_priority: true,
    },
    ml_predictions: [],
    workers_needed: { byHour: [], byDay: [] },
    employees: [
      {
        id: "e1",
        name: "Alice",
        role: "COOK",
        availability: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }],
        rush_hour_suitability: 0.9,
        performance_level: 0.8,
        reliability_score: 0.95,
        preferred_shift_type: "MORNING",
        min_hours_guaranteed: 20,
        max_hours: 40,
        hours_scheduled_so_far: 0,
      },
    ],
    manager_preferences: [],
    ai_mistake_patterns: [],
    recent_schedules: [],
    ...overrides,
  };
}

describe("promptBuilder", () => {
  it("system prompt uses the COOK|CASHIER|PACKLINER taxonomy", () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain("COOK|CASHIER|PACKLINER");
    expect(sys).toContain("DO NOT REPEAT AI MISTAKES");
    expect(sys).toContain("LSL historical");
  });

  it("includes historical LSL style when fixture is present", () => {
    const msg = buildUserMessage(baseInput());
    expect(msg).toContain("HISTORICAL LSL SCHEDULE STYLE");
  });

  it("includes ML-learned prior when provided", () => {
    const msg = buildUserMessage(
      baseInput({
        scheduling_prior: {
          weeks_trained: 12,
          shifts_learned: 500,
          guidance: ["Use open + close crews"],
          shift_templates: [{ start: "10:00", end: "17:00", weight: 0.3 }],
          dow_multiplier: { "5": 1.2, "6": 1.15 },
        },
      })
    );
    expect(msg).toContain("ML-LEARNED SCHEDULING PRIOR");
    expect(msg).toContain("10:00–17:00");
    expect(msg).toContain("do NOT copy verbatim");
  });

  it("excludes the peak window section when there are no peak windows", () => {
    const msg = buildUserMessage(baseInput());
    expect(msg).not.toContain("ML-PREDICTED PEAK WINDOWS");
  });

  it("includes the peak window section when a peak exists", () => {
    const msg = buildUserMessage(
      baseInput({
        ml_predictions: [
          {
            date: "2026-06-01",
            hour: 18,
            traffic_multiplier: 1.8,
            recommended: { cook: 2, cash: 2, pack: 1 },
            is_peak: true,
          },
        ],
      })
    );
    expect(msg).toContain("ML PEAK WINDOWS");
    expect(msg).toContain("TARGET SCHEDULE WEEK");
    expect(msg).toContain("1.8x");
  });

  it("excludes manager preferences section when there are none", () => {
    const msg = buildUserMessage(baseInput());
    expect(msg).not.toContain("LEARNED MANAGER PREFERENCES");
  });

  it("includes manager preferences when present", () => {
    const msg = buildUserMessage(
      baseInput({
        manager_preferences: [
          {
            pattern_type: "employee_shift_preference",
            description: "Alice preferred for Monday mornings",
            structured_data: {},
            confidence_score: 0.7,
          },
        ],
      })
    );
    expect(msg).toContain("LEARNED MANAGER PREFERENCES");
    expect(msg).toContain("Alice preferred for Monday mornings");
  });

  it("includes AI mistake patterns when present", () => {
    const msg = buildUserMessage(
      baseInput({
        ai_mistake_patterns: [
          {
            pattern_type: "ai_mistake_pattern",
            description: "Do not schedule Bob on Friday evenings",
            structured_data: {},
            confidence_score: 0.8,
          },
        ],
      })
    );
    expect(msg).toContain("DO NOT REPEAT AI MISTAKES");
    expect(msg).toContain("Bob on Friday evenings");
  });
});
