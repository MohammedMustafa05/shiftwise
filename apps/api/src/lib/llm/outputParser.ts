import type {
  LLMRole,
  LLMScheduleOutput,
  LLMShiftSuggestion,
  UnfilledSlot,
} from "@shiftagent/shared";
import { LLM_ROLES } from "@shiftagent/shared";

export class LLMOutputParseError extends Error {
  rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(message);
    this.name = "LLMOutputParseError";
    this.rawOutput = rawOutput;
  }
}

const TIME_REGEX = /^\d{2}:\d{2}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isRole(value: unknown): value is LLMRole {
  return typeof value === "string" && (LLM_ROLES as string[]).includes(value);
}

/** Strip fences and extract the outermost JSON object when the model adds prose. */
export function extractJsonPayload(raw: string): string {
  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (cleaned.startsWith("{")) return cleaned;

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  return cleaned;
}

export function parseAndValidateLLMOutput(raw: string): LLMScheduleOutput {
  const cleaned = extractJsonPayload(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new LLMOutputParseError("LLM output is not valid JSON", raw);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new LLMOutputParseError("LLM output is not an object", raw);
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.shifts)) {
    throw new LLMOutputParseError('Missing or invalid "shifts" array', raw);
  }

  const shifts: LLMShiftSuggestion[] = obj.shifts.map((s: unknown, i: number) => {
    if (typeof s !== "object" || s === null) {
      throw new LLMOutputParseError(`Shift at index ${i} is not an object`, raw);
    }
    const shift = s as Record<string, unknown>;

    const required = ["employee_id", "date", "start_time", "end_time", "role"];
    for (const field of required) {
      if (!shift[field]) {
        throw new LLMOutputParseError(`Shift at index ${i} missing field: ${field}`, raw);
      }
    }

    if (!isRole(shift.role)) {
      throw new LLMOutputParseError(`Shift at index ${i} has invalid role: ${String(shift.role)}`, raw);
    }

    if (!TIME_REGEX.test(shift.start_time as string) || !TIME_REGEX.test(shift.end_time as string)) {
      throw new LLMOutputParseError(`Shift at index ${i} has invalid time format`, raw);
    }

    if (!DATE_REGEX.test(shift.date as string)) {
      throw new LLMOutputParseError(`Shift at index ${i} has invalid date format`, raw);
    }

    return {
      employee_id: shift.employee_id as string,
      date: shift.date as string,
      start_time: shift.start_time as string,
      end_time: shift.end_time as string,
      role: shift.role,
      reasoning: typeof shift.reasoning === "string" ? shift.reasoning : "",
      confidence: typeof shift.confidence === "number" ? shift.confidence : 0.7,
    };
  });

  const unfilled: UnfilledSlot[] = Array.isArray(obj.unfilled_slots)
    ? (obj.unfilled_slots as unknown[])
        .filter((u): u is Record<string, unknown> => typeof u === "object" && u !== null)
        .map((u) => ({
          date: String(u.date ?? ""),
          role: isRole(u.role) ? u.role : "COOK",
          required_start: String(u.required_start ?? ""),
          required_end: String(u.required_end ?? ""),
          reason: String(u.reason ?? ""),
        }))
    : [];

  return {
    shifts,
    unfilled_slots: unfilled,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    warnings: Array.isArray(obj.warnings) ? (obj.warnings as unknown[]).map(String) : [],
  };
}
