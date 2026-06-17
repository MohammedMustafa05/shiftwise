export type Role = 'Cashier' | 'Cook' | 'Packliner';
export type EmployeeType = 'Full Time' | 'Part Time';
export type ExperienceLevel = 'Veteran' | 'Intermediate' | 'Trainee';
export type ShiftTier = 'Rush-capable' | 'Light shifts';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ScheduleStatus = 'draft' | 'published';
export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type ShiftType = 'morning' | 'afternoon' | 'evening';
export type PeriodKey = 'peak' | 'off_peak';

export interface Employee {
  id: string;
  /** API user id (for shift assignment) */
  userId?: string;
  created_at: string;
  name: string;
  preferred_name?: string;
  email: string;
  phone: string;
  role: Role[];
  experience_level: ExperienceLevel;
  shift_tier: ShiftTier;
  min_hours: number;
  max_hours: number;
  full_day_capable?: boolean;
  employee_type: EmployeeType;
  pairing_always_with: string[];
  pairing_never_with: string[];
}

// availability_grid: each day maps to an array of available hour strings e.g. ["10:00","11:00","14:00"]
export type AvailabilityGrid = Record<DayKey, string[]>;

export interface AvailabilityBlockSummary {
  day: string;
  block: string;
  timeRange: string;
}

export interface AvailabilityRequest {
  id: string;
  employee_id: string;
  employee?: Employee;
  week_start_date: string;
  availability_grid: AvailabilityGrid;
  availability_blocks?: AvailabilityBlockSummary[];
  is_first_approval?: boolean;
  status: ApprovalStatus;
  submitted_at: string;
}

export interface TimeOffRequest {
  id: string;
  employee_id: string;
  employee?: Employee;
  start_date: string;
  end_date: string;
  reason: string;
  status: ApprovalStatus;
  submitted_at: string;
}

export interface TimeRangeRule {
  from: string;
  to: string;
  cashiers: number;
  cooks: number;
  packliners: number;
}

export interface RoleMinimums {
  cashiers: number;
  cooks: number;
  packliners: number;
}

export interface Preferences {
  id: string;
  labor_cost_target: number;
  max_consecutive_days: number;
  min_availability_hours: number;
  min_days_off_per_week: number;
  role_requirements: Record<string, TimeRangeRule[]>;
  operating_hours: {
    open: string;
    close: string;
  };
}

export interface HourlySales {
  [hour: string]: number;
}

export interface SalesData {
  id: string;
  date: string;
  hourly_sales: HourlySales;
  week_start_date: string;
}

export interface ScheduleFlag {
  type: string;
  date?: string;
  hour?: number;
  message?: string;
}

export interface WorkersNeededHour {
  date: string;
  hour: number;
  sales: number;
  workers: number;
}

export interface WorkersNeededDay {
  date: string;
  sales: number;
  workers: number;
}

export interface PreferenceOverride {
  employeeName: string;
  suggested: string;
  scheduled: string;
  reason: string;
}

export interface LlmSuggestedShift {
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  role: string;
  day?: string;
}

export interface ScheduleMlMetadata {
  workersNeeded?: { byHour: WorkersNeededHour[]; byDay: WorkersNeededDay[] };
  preferenceOverrides?: PreferenceOverride[];
  llmSuggestedShifts?: LlmSuggestedShift[];
  flags?: ScheduleFlag[];
  engineVersion?: string;
  labourCostPct?: number;
  avgHourlyWage?: number;
  salesReferenceWeekStart?: string;
  salesReferenceWeekEnd?: string;
  roleRequirementsConfigured?: boolean;
}

export interface Schedule {
  id: string;
  week_start_date: string;
  status: ScheduleStatus;
  generated_at: string;
  last_modified: string;
  ml_metadata?: ScheduleMlMetadata;
}

export interface Shift {
  id: string;
  schedule_id: string;
  employee_id: string;
  employee?: Employee;
  role: Role;
  date: string;
  start_time: string;
  end_time: string;
  is_locked: boolean;
  shift_type: ShiftType;
  is_engine_suggested?: boolean;
  llm_reasoning?: string | null;
}

export interface ActivityItem {
  id: string;
  type: 'schedule_generated' | 'employee_approved' | 'schedule_published' | 'employee_added' | 'shift_edited';
  message: string;
  timestamp: string;
  actor?: string;
}
