/** JSON schema for Anthropic structured output (messages.parse output_config). */
export const LLM_SCHEDULE_OUTPUT_JSON_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["shifts", "unfilled_slots", "summary", "warnings"],
  properties: {
    shifts: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["employee_id", "date", "start_time", "end_time", "role"],
        properties: {
          employee_id: { type: "string" as const },
          date: { type: "string" as const },
          start_time: { type: "string" as const },
          end_time: { type: "string" as const },
          role: { type: "string" as const, enum: ["COOK", "CASHIER", "PACKLINER"] },
          reasoning: { type: "string" as const },
          confidence: { type: "number" as const },
        },
      },
    },
    unfilled_slots: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          date: { type: "string" as const },
          role: { type: "string" as const, enum: ["COOK", "CASHIER", "PACKLINER"] },
          required_start: { type: "string" as const },
          required_end: { type: "string" as const },
          reason: { type: "string" as const },
        },
      },
    },
    summary: { type: "string" as const },
    warnings: { type: "array" as const, items: { type: "string" as const } },
  },
};
