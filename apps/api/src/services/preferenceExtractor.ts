import type { ManagerPreferencePattern } from "@shiftagent/shared";
import { query } from "../db/pool.js";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? "Unknown";
}

/** Active learned preferences (non-mistake patterns) with enough evidence. */
export async function extractManagerPreferences(
  workplaceId: string
): Promise<ManagerPreferencePattern[]> {
  try {
    const result = await query<{
      pattern_type: string;
      description: string;
      structured_data: Record<string, unknown>;
      confidence_score: string | number;
    }>(
      `SELECT pattern_type, description, structured_data, confidence_score
       FROM manager_preferences
       WHERE workplace_id = $1 AND is_active = true AND is_mistake_pattern = false
         AND confidence_score >= 0.4
       ORDER BY confidence_score DESC
       LIMIT 20`,
      [workplaceId]
    );
    return result.rows.map((row) => ({
      pattern_type: row.pattern_type,
      description: row.description,
      structured_data: row.structured_data ?? {},
      confidence_score: Number(row.confidence_score),
    }));
  } catch (err) {
    console.warn("[preferenceExtractor] extractManagerPreferences failed:", err);
    return [];
  }
}

/** AI mistake patterns the manager flagged — shown as "DO NOT REPEAT" in prompts. */
export async function extractAIMistakePatterns(
  workplaceId: string
): Promise<ManagerPreferencePattern[]> {
  try {
    const result = await query<{
      pattern_type: string;
      description: string;
      structured_data: Record<string, unknown>;
      confidence_score: string | number;
    }>(
      `SELECT pattern_type, description, structured_data, confidence_score
       FROM manager_preferences
       WHERE workplace_id = $1 AND is_active = true AND is_mistake_pattern = true
       ORDER BY confidence_score DESC
       LIMIT 15`,
      [workplaceId]
    );
    return result.rows.map((row) => ({
      pattern_type: row.pattern_type,
      description: row.description,
      structured_data: row.structured_data ?? {},
      confidence_score: Number(row.confidence_score),
    }));
  } catch (err) {
    console.warn("[preferenceExtractor] extractAIMistakePatterns failed:", err);
    return [];
  }
}

/**
 * Records a manager edit as a learned pattern when tagged new_permanent_preference
 * or fixing_ai_mistake. Exceptions and events are stored in schedule_overrides only.
 */
export async function processNewOverride(params: {
  workplaceId: string;
  overrideReason: string;
  originalEmployeeId: string | null;
  newEmployeeId: string | null;
  shiftDate: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  role: string;
  notes?: string | null;
}): Promise<void> {
  if (params.overrideReason === "one_time_exception" || params.overrideReason === "event_special_occasion") {
    return;
  }
  if (!params.originalEmployeeId || !params.newEmployeeId) return;

  const isMistake = params.overrideReason === "fixing_ai_mistake";
  const patternType = isMistake ? "ai_mistake_pattern" : "employee_shift_preference";
  const baseConfidence = isMistake ? 0.8 : 0.4;

  const description =
    params.notes?.trim() ||
    (isMistake
      ? `AI mistake: manager replaced ${params.originalEmployeeId} with ${params.newEmployeeId} for ${params.role} on ${dayName(params.dayOfWeek)} ${params.startTime}-${params.endTime}`
      : `Manager prefers employee ${params.newEmployeeId} over ${params.originalEmployeeId} for ${params.role} shifts on ${dayName(params.dayOfWeek)} around ${params.startTime}`);

  const structuredData = {
    preferred_employee_id: params.newEmployeeId,
    replaced_employee_id: params.originalEmployeeId,
    role: params.role,
    day_of_week: params.dayOfWeek,
    time_window_start: params.startTime,
    time_window_end: params.endTime,
  };

  const existing = await query<{
    id: string;
    times_observed: number;
    confidence_score: string | number;
    structured_data: Record<string, unknown>;
    is_mistake_pattern: boolean;
  }>(
    `SELECT id, times_observed, confidence_score, structured_data, is_mistake_pattern
     FROM manager_preferences
     WHERE workplace_id = $1 AND pattern_type = $2`,
    [params.workplaceId, patternType]
  );

  const match = existing.rows.find((row) => {
    const sd = row.structured_data ?? {};
    return (
      String(sd.preferred_employee_id) === params.newEmployeeId &&
      String(sd.day_of_week) === String(params.dayOfWeek) &&
      String(sd.role) === params.role
    );
  });

  if (match) {
    const newCount = match.times_observed + 1;
    const newConfidence = Math.min(0.95, Number(match.confidence_score) + (isMistake ? 0.05 : 0.15));
    await query(
      `UPDATE manager_preferences
       SET times_observed = $2, confidence_score = $3, last_observed_at = now(), description = $4
       WHERE id = $1`,
      [match.id, newCount, newConfidence, description]
    );
  } else {
    await query(
      `INSERT INTO manager_preferences
       (workplace_id, pattern_type, description, structured_data, confidence_score, times_observed, is_mistake_pattern)
       VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [
        params.workplaceId,
        patternType,
        description,
        JSON.stringify(structuredData),
        baseConfidence,
        isMistake,
      ]
    );
  }
}
