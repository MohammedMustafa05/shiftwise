import OpenAI from "openai";
import { config } from "../../../config.js";
import type { LLMProvider, LLMRawResult } from "../types.js";

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = config.openaiApiKey.trim();
  if (!apiKey) return null;
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

export const openaiProvider: LLMProvider = {
  name: "openai",

  isConfigured() {
    return Boolean(config.openaiApiKey.trim());
  },

  async generate({ systemPrompt, userMessage, attempt }) {
    const openai = getClient();
    if (!openai) throw new Error("OpenAI API key not configured");

    const model = config.llmOpenaiModel;
    const startTime = Date.now();

    const response = await openai.chat.completions.create({
      model,
      max_tokens: config.llmMaxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: attempt === 1 ? 0.3 : 0.1,
    });

    const rawOutput = response.choices[0]?.message?.content ?? "";

    return {
      rawOutput,
      model,
      providerName: "openai",
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      generationTimeMs: Date.now() - startTime,
      attempt,
    };
  },
};

export function isOpenAIConfigured(): boolean {
  return openaiProvider.isConfigured();
}
