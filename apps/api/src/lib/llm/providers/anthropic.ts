import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema.js";
import { config } from "../../../config.js";
import { LLM_SCHEDULE_OUTPUT_JSON_SCHEMA } from "../llmOutputSchema.js";
import type { LLMProvider, LLMRawResult } from "../types.js";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = config.anthropicApiKey.trim();
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

function textFromResponse(response: Anthropic.Message): string {
  const first = response.content[0];
  if (first && first.type === "text") return first.text;
  const parsed = (response as Anthropic.Message & { parsed_output?: unknown }).parsed_output;
  if (parsed !== undefined && parsed !== null) {
    return JSON.stringify(parsed);
  }
  return "";
}

export const anthropicProvider: LLMProvider = {
  name: "anthropic",

  isConfigured() {
    return Boolean(config.anthropicApiKey.trim());
  },

  async generate({ systemPrompt, userMessage, attempt }) {
    const anthropic = getClient();
    if (!anthropic) throw new Error("Anthropic API key not configured");

    const model = attempt === 1 ? config.llmPrimaryModel : config.llmFallbackModel;
    const startTime = Date.now();

    const baseParams = {
      model,
      max_tokens: config.llmMaxTokens,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
    };

    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.parse({
        ...baseParams,
        output_config: {
          format: jsonSchemaOutputFormat(LLM_SCHEDULE_OUTPUT_JSON_SCHEMA),
        },
      });
    } catch (err) {
      console.warn("[Anthropic] Structured output failed, using plain JSON completion:", err);
      response = await anthropic.messages.create({
        ...baseParams,
        messages: [
          {
            role: "user",
            content: `${userMessage}\n\nReply with ONLY one JSON object. No markdown fences. No text before or after the JSON.`,
          },
        ],
      });
    }

    return {
      rawOutput: textFromResponse(response),
      model,
      providerName: "anthropic",
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      generationTimeMs: Date.now() - startTime,
      attempt,
    };
  },
};

export function isAnthropicConfigured(): boolean {
  return anthropicProvider.isConfigured();
}
