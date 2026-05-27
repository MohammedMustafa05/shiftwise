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
  min_shifts_per_week?: number;
  max_shifts_per_week?: number;
  employee_type: EmployeeType;
  pairing_always_with: string[];
  pairing_never_with: string[];
}

// availability_grid: each day maps to an array of available hour strings e.g. ["10:00","11:00","14:00"]
export type AvailabilityGrid = Record<DayKey, string[]>;

export interface AvailabilityRequest {
  id: string;
  employee_id: string;
  employee?: Employee;
  week_start_date: string;
  availability_grid: AvailabilityGrid;
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
  max_hours_per_week: number;
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

export interface Schedule {
  id: string;
  week_start_date: string;
  status: ScheduleStatus;
  generated_at: string;
  last_modified: string;
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
}

export interface ActivityItem {
  id: string;
  type: 'schedule_generated' | 'employee_approved' | 'schedule_published' | 'employee_added' | 'shift_edited';
  message: string;
  timestamp: string;
  actor?: string;
}
