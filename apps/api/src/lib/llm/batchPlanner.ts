import type { LLMPlannerInput, LLMScheduleOutput, LLMShiftSuggestion } from "@shiftagent/shared";
import { buildSystemPrompt, buildUserMessageForDay, scheduleDateForDay } from "./promptBuilder.js";
import { parseAndValidateLLMOutput, LLMOutputParseError } from "./outputParser.js";
import type { LLMProvider, LLMRawResult } from "./types.js";
import { parseTimeToHours } from "../../utils/dates.js";

/** Mon → Sun order for sequential hour tracking across the week. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function shiftHours(shift: LLMShiftSuggestion): number {
  return parseTimeToHours(shift.start_time, shift.end_time);
}

/**
 * Large rosters: one LLM call per day to avoid truncated JSON on full-week output.
 */
export async function routeLLMRequestByDay(
  input: LLMPlannerInput,
  scheduleId: string,
  provider: LLMProvider,
  logGeneration: (result: LLMRawResult) => Promise<void>
): Promise<LLMScheduleOutput> {
  const systemPrompt = buildSystemPrompt();
  const hoursSoFar = new Map<string, number>();
  for (const fa of input.floor_assignments ?? []) {
    hoursSoFar.set(
      fa.employee_id,
      (hoursSoFar.get(fa.employee_id) ?? 0) + shiftHours(fa as LLMShiftSuggestion)
    );
  }
  const allShifts: LLMShiftSuggestion[] = [];
  const allUnfilled: LLMScheduleOutput["unfilled_slots"] = [];
  const warnings: string[] = [];
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalMs = 0;
  const modelUsed = new Set<string>();

  for (const dayOfWeek of DAY_ORDER) {
    const scheduleDate = scheduleDateForDay(input.week_start, dayOfWeek);
    const userMessage = buildUserMessageForDay(input, scheduleDate, dayOfWeek, hoursSoFar);

    let dayOutput: LLMScheduleOutput | null = null;
    let lastErr: LLMOutputParseError | null = null;

    for (let attempt = 1; attempt <= 2 && !dayOutput; attempt++) {
      try {
        const result = await provider.generate({ systemPrompt, userMessage, attempt });
        await logGeneration(result);
        totalPrompt += result.promptTokens;
        totalCompletion += result.completionTokens;
        totalMs += result.generationTimeMs;
        modelUsed.add(result.model);

        dayOutput = parseAndValidateLLMOutput(result.rawOutput);
      } catch (err) {
        if (err instanceof LLMOutputParseError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    if (!dayOutput) {
      warnings.push(
        `${scheduleDate}: AI could not produce valid shifts (${lastErr?.message ?? "unknown error"})`
      );
      continue;
    }

    for (const s of dayOutput.shifts) {
      if (s.date !== scheduleDate) continue;
      allShifts.push(s);
      hoursSoFar.set(s.employee_id, (hoursSoFar.get(s.employee_id) ?? 0) + shiftHours(s));
    }
    for (const u of dayOutput.unfilled_slots) {
      if (u.date === scheduleDate) allUnfilled.push(u);
    }
    warnings.push(...dayOutput.warnings);
  }

  return {
    shifts: allShifts,
    unfilled_slots: allUnfilled,
    summary:
      allShifts.length > 0
        ? `AI schedule built day-by-day (${allShifts.length} shifts across ${DAY_ORDER.length} days).`
        : "AI day-by-day scheduling produced no shifts; rule-based fill will apply.",
    warnings: [
      ...warnings,
      `Models: ${[...modelUsed].join(", ") || "n/a"}; tokens in/out: ${totalPrompt}/${totalCompletion}; ${totalMs}ms`,
    ],
  };
}
