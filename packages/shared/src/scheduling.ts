import { z } from "zod";
import { WorkersNeeded, ScheduleFlag } from "./schedule.js";
import { WorkplacePreferences } from "./workplace.js";

/** Per time-band role minimums (matches web Preferences UI). */
export const RoleRequirementBand = z.object({
  from: z.string(),
  to: z.string(),
  cashiers: z.number().int().min(0),
  cooks: z.number().int().min(0),
  packliners: z.number().int().min(0),
});

export const RoleRequirementsByDay = z.record(z.array(RoleRequirementBand));

export const SchedulingConstraints = z.object({
  maxConsecutiveDays: z.number().int().positive().optional(),
  minAvailabilityHours: z.number().nonnegative().optional(),
  maxHoursPerWeek: z.number().positive().optional(),
  minWorkersPerHour: z.number().int().min(0).optional(),
  maxWorkersPerHour: z.number().int().min(0).optional(),
  roleRequirements: RoleRequirementsByDay.optional(),
});

export const EngineOperatingHoursDay = z.object({
  open: z.string(),
  close: z.string(),
  closed: z.boolean().optional(),
});

export const OperatingHoursConfig = z.object({
  default: z.object({ open: z.string(), close: z.string() }),
  byDay: z.record(EngineOperatingHoursDay).optional(),
});

export const EngineSalesRow = z.object({
  date: z.string(),
  hour: z.number().int().min(0).max(23),
  sales_amount: z.number().nonnegative(),
});

export const EngineEmployee = z.object({
  user_id: z.string().uuid(),
  role: z.string(),
  roles: z.array(z.string()).default([]),
  experience_level: z.string().optional(),
  shift_tier: z.string().optional(),
  min_hours: z.number().optional(),
  max_hours: z.number().optional(),
  min_shifts_per_week: z.number().optional(),
  max_shifts_per_week: z.number().optional(),
  pairing_always_with: z.array(z.string()).default([]),
  pairing_never_with: z.array(z.string()).default([]),
});

export const EngineAvailabilityBlock = z.object({
  user_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string(),
  end_time: z.string(),
});

export const EngineTimeOff = z.object({
  user_id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
});

export const EngineAvailabilitySubmission = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
});

export const EngineGenerateRequest = z.object({
  workplace_id: z.string().uuid(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sales: z.array(EngineSalesRow),
  preferences: WorkplacePreferences,
  operating_hours: OperatingHoursConfig,
  role_requirements: RoleRequirementsByDay.default({}),
  employees: z.array(EngineEmployee),
  availability: z.array(EngineAvailabilityBlock),
  approved_time_off: z.array(EngineTimeOff).default([]),
  availability_submissions: z.array(EngineAvailabilitySubmission).default([]),
});

export const EngineRoleDemandHour = z.object({
  date: z.string(),
  hour: z.number().int(),
  cashiers: z.number().int(),
  cooks: z.number().int(),
  packliners: z.number().int(),
});

export const EngineShiftOut = z.object({
  employeeId: z.string().uuid(),
  day: z.string(),
  shiftDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  role: z.string(),
  location: z.string().optional(),
});

export const EngineGenerateResponse = z.object({
  status: z.enum(["draft", "published"]).default("draft"),
  workers_needed: WorkersNeeded,
  workersNeeded: WorkersNeeded.optional(),
  roleDemandByHour: z.array(EngineRoleDemandHour).optional(),
  role_demand_by_hour: z.array(EngineRoleDemandHour).optional(),
  shifts: z.array(EngineShiftOut),
  flags: z.array(ScheduleFlag),
  engineVersion: z.string().optional(),
  engine_version: z.string().optional(),
});

export type RoleRequirementBand = z.infer<typeof RoleRequirementBand>;
export type RoleRequirementsByDay = z.infer<typeof RoleRequirementsByDay>;
export type SchedulingConstraints = z.infer<typeof SchedulingConstraints>;
export type OperatingHoursConfig = z.infer<typeof OperatingHoursConfig>;
export type EngineSalesRow = z.infer<typeof EngineSalesRow>;
export type EngineEmployee = z.infer<typeof EngineEmployee>;
export type EngineAvailabilityBlock = z.infer<typeof EngineAvailabilityBlock>;
export type EngineGenerateRequest = z.infer<typeof EngineGenerateRequest>;
export type EngineGenerateResponse = z.infer<typeof EngineGenerateResponse>;
