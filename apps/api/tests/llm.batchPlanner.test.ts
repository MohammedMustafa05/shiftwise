import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMPlannerInput } from "@shiftagent/shared";
import { routeLLMRequest } from "../src/lib/llm/router.js";
import { scheduleDateForDay } from "../src/lib/llm/promptBuilder.js";

vi.mock("../src/lib/llm/providers/anthropic.js", () => ({
  anthropicProvider: {
    name: "anthropic",
    isConfigured: vi.fn(() => true),
    generate: vi.fn(),
  },
}));

vi.mock("../src/lib/llm/providers/openai.js", () => ({
  openaiProvider: {
    name: "openai",
    isConfigured: vi.fn(() => false),
    generate: vi.fn(),
  },
}));

vi.mock("../src/db/pool.js", () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

import { anthropicProvider } from "../src/lib/llm/providers/anthropic.js";

const dayJson = (date: string, employeeId: string) =>
  JSON.stringify({
    shifts: [
      {
        employee_id: employeeId,
        date,
        start_time: "10:00",
        end_time: "15:00",
        role: "COOK",
      },
    ],
    unfilled_slots: [],
    summary: "ok",
    warnings: [],
  });

function makeEmployees(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    name: `Emp ${i + 1}`,
    role: "COOK" as const,
    availability: [{ day_of_week: 1, start_time: "10:00", end_time: "17:00" }],
    rush_hour_suitability: 0.8,
    performance_level: 0.8,
    reliability_score: 0.8,
    preferred_shift_type: "ANY" as const,
    min_hours_guaranteed: 0,
    max_hours: 45,
    hours_scheduled_so_far: 0,
  }));
}

describe("scheduleDateForDay", () => {
  it("maps Sunday to end of week", () => {
    expect(scheduleDateForDay("2026-06-01", 0)).toBe("2026-06-07");
    expect(scheduleDateForDay("2026-06-01", 1)).toBe("2026-06-01");
  });
});

describe("LLM batch router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(anthropicProvider.isConfigured).mockReturnValue(true);
  });

  it("uses day-by-day calls when roster is large", async () => {
    const mon = "2026-06-01";
    vi.mocked(anthropicProvider.generate).mockImplementation(async ({ userMessage }) => {
      const dateMatch = userMessage.match(/SCHEDULE THIS DAY ONLY: (\d{4}-\d{2}-\d{2})/);
      const date = dateMatch?.[1] ?? mon;
      return {
        rawOutput: dayJson(date, "00000000-0000-0000-0000-000000000001"),
        model: "claude-sonnet-4-6",
        providerName: "anthropic",
        promptTokens: 10,
        completionTokens: 10,
        generationTimeMs: 5,
        attempt: 1,
      };
    });

    const input: LLMPlannerInput = {
      workplace_id: "wp-1",
      week_start: mon,
      scheduling_preferences: {
        staffing_requirements: { monday: { COOK: { min_count: 1 } } },
        max_weekly_hours: 45,
        max_hours_per_employee: 45,
        overtime_threshold: 40,
        overtime_rules: "FLAG_ONLY",
        rush_hour_priority: true,
      },
      ml_predictions: [],
      workers_needed: {
        byHour: [],
        byDay: [{ date: mon, sales: 1000, workers: 3 }],
      },
      employees: makeEmployees(12),
      manager_preferences: [],
      ai_mistake_patterns: [],
      recent_schedules: [],
    };

    const out = await routeLLMRequest(input, "sched-batch");
    expect(anthropicProvider.generate).toHaveBeenCalledTimes(7);
    expect(out.shifts.length).toBeGreaterThanOrEqual(1);
    expect(out.summary).toContain("day-by-day");
  });
});
