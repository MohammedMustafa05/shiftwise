import type { LLMPlannerInput, LLMScheduleOutput } from "@shiftagent/shared";
import { routeLLMRequest, isLLMConfigured } from "../lib/llm/router.js";

export { isLLMConfigured };

/**
 * Asks the configured LLM provider for a candidate schedule. Returns empty output
 * when no API key is configured or all validation attempts fail. Never throws.
 */
export async function generateScheduleWithLLM(
  input: LLMPlannerInput,
  scheduleId: string
): Promise<LLMScheduleOutput> {
  return routeLLMRequest(input, scheduleId);
}
