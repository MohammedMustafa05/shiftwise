import type { LLMScheduleOutput } from "@shiftagent/shared";

export interface LLMRawResult {
  rawOutput: string;
  model: string;
  providerName: string;
  promptTokens: number;
  completionTokens: number;
  generationTimeMs: number;
  attempt: number;
}

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(params: {
    systemPrompt: string;
    userMessage: string;
    attempt: number;
  }): Promise<LLMRawResult>;
}

export type { LLMScheduleOutput };
