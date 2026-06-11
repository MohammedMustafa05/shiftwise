import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMPlannerInput } from "@shiftagent/shared";
import { routeLLMRequest, isLLMConfigured } from "../src/lib/llm/router.js";

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

const validOutput = JSON.stringify({
  shifts: [
    {
      employee_id: "11111111-1111-1111-1111-111111111111",
      date: "2026-06-01",
      start_time: "09:00",
      end_time: "17:00",
      role: "COOK",
      reasoning: "Best cook available.",
      confidence: 0.9,
    },
  ],
  unfilled_slots: [],
  summary: "Good week",
  warnings: [],
});

const baseInput: LLMPlannerInput = {
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
  employees: [],
  manager_preferences: [],
  ai_mistake_patterns: [],
  recent_schedules: [],
};

describe("LLM router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(anthropicProvider.isConfigured).mockReturnValue(true);
  });

  it("returns parsed output on success", async () => {
    vi.mocked(anthropicProvider.generate).mockResolvedValue({
      rawOutput: validOutput,
      model: "claude-sonnet-4-6",
      providerName: "anthropic",
      promptTokens: 100,
      completionTokens: 50,
      generationTimeMs: 200,
      attempt: 1,
    });

    const out = await routeLLMRequest(baseInput, "sched-1");
    expect(out.shifts).toHaveLength(1);
    expect(out.summary).toBe("Good week");
  });

  it("returns empty output when provider not configured", async () => {
    vi.mocked(anthropicProvider.isConfigured).mockReturnValue(false);
    const out = await routeLLMRequest(baseInput, "sched-1");
    expect(out.shifts).toHaveLength(0);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("isLLMConfigured reflects provider availability", () => {
    vi.mocked(anthropicProvider.isConfigured).mockReturnValue(true);
    expect(isLLMConfigured()).toBe(true);
  });
});
