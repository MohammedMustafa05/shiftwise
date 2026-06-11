// Shared types for the LLM scheduling layer.
// Roles use the ShiftWise taxonomy (COOK | CASHIER | PACKLINER), not the generic COOK|PACK|CASH.

export type LLMRole = "COOK" | "CASHIER" | "PACKLINER";

export const LLM_ROLES: LLMRole[] = ["COOK", "CASHIER", "PACKLINER"];

export type OverrideReason =
  | "new_permanent_preference"
  | "one_time_exception"
  | "event_special_occasion"
  | "fixing_ai_mistake";

export const OVERRIDE_REASONS: OverrideReason[] = [
  "new_permanent_preference",
  "one_time_exception",
  "event_special_occasion",
  "fixing_ai_mistake",
];

export interface LLMShiftSuggestion {
  employee_id: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM (workplace timezone)
  end_time: string; // HH:MM (workplace timezone)
  role: LLMRole;
  reasoning: string; // One sentence shown to manager in UI
  confidence: number; // 0.0-1.0
}

export interface UnfilledSlot {
  date: string;
  role: LLMRole;
  required_start: string;
  required_end: string;
  reason: string;
}

export interface LLMScheduleOutput {
  shifts: LLMShiftSuggestion[];
  unfilled_slots: UnfilledSlot[];
  summary: string;
  warnings: string[];
}

export interface LLMAvailabilityBlock {
  day_of_week: number; // 0=Sunday, 1=Monday...
  start_time: string; // HH:MM
  end_time: string; // HH:MM
}

export interface EmployeeContext {
  id: string;
  name: string;
  role: LLMRole;
  /** All roles this employee can work (multi-role). */
  roles?: LLMRole[];
  availability: LLMAvailabilityBlock[];
  rush_hour_suitability: number; // 0.0-1.0
  performance_level: number; // 0.0-1.0
  reliability_score: number; // 0.0-1.0
  preferred_shift_type: "MORNING" | "AFTERNOON" | "EVENING" | "ANY";
  min_hours_guaranteed: number;
  max_hours: number;
  hours_scheduled_so_far: number;
}

export interface MLHourlyPrediction {
  date: string;
  hour: number;
  traffic_multiplier: number;
  recommended: {
    cook: number;
    cash: number;
    pack: number;
  };
  is_peak: boolean; // multiplier > 1.4
}

export interface ManagerPreferencePattern {
  pattern_type: string;
  description: string;
  structured_data: Record<string, unknown>;
  confidence_score: number;
}

export interface RecentScheduleContext {
  week_start: string;
  was_exception_week: boolean;
  manager_edits_count: number;
  key_patterns: string[];
}

export interface SchedulingPreferences {
  staffing_requirements: Record<string, Record<string, { min_count: number }>>;
  max_weekly_hours: number;
  max_hours_per_employee: number;
  overtime_threshold: number;
  overtime_rules: "NONE" | "FLAG_ONLY" | "BLOCK";
  rush_hour_priority: boolean;
}

/** ML labour caps: (sales × labour %) ÷ 21, minimum 3 workers. */
export interface WorkersNeededSnapshot {
  byHour: Array<{
    date: string;
    hour: number;
    sales: number;
    workers: number;
    roles?: { COOK: number; CASHIER: number; PACKLINER: number };
  }>;
  byDay: Array<{ date: string; sales: number; workers: number }>;
}

export interface FloorAssignment {
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  role: LLMRole;
}

export interface FloorGap {
  code: "H1_ROLE_COVERAGE_GAP" | "H3_LATE_NIGHT_HEADCOUNT";
  date: string;
  hour: number;
  role?: LLMRole;
  detail: string;
}

export interface LLMPlannerInput {
  workplace_id: string;
  week_start: string; // YYYY-MM-DD (Monday)
  scheduling_preferences: SchedulingPreferences;
  ml_predictions: MLHourlyPrediction[];
  /** Hard caps from ML — do not schedule more than this headcount per day/hour. */
  workers_needed: WorkersNeededSnapshot;
  employees: EmployeeContext[];
  manager_preferences: ManagerPreferencePattern[];
  ai_mistake_patterns: ManagerPreferencePattern[];
  recent_schedules: RecentScheduleContext[];
  /** Optional lines from imported historical Clearview schedules (LSL style). */
  historical_style_notes?: string[];
  /** ML-learned scheduling shape (from historical_prior), not copied shifts. */
  scheduling_prior?: Record<string, unknown>;
  /** Mandatory floor shifts already assigned — LLM must not contradict these. */
  floor_assignments?: FloorAssignment[];
  /** Slots the floor engine could not fill — LLM should not attempt to override. */
  floor_gaps?: FloorGap[];
}
