import { z } from "zod";

export const ScheduleStatus = z.enum(["draft", "published"]);

export const HourlyRoleCounts = z.object({
  COOK: z.number().int(),
  CASHIER: z.number().int(),
  PACKLINER: z.number().int(),
});

export const WorkersNeededHour = z.object({
  date: z.string(),
  hour: z.number().int(),
  sales: z.number(),
  /** Formula total (floor + extras). */
  workers: z.number().int(),
  /** Mandatory floor count (always 3). */
  mandatoryFloor: z.number().int().optional(),
  /** Total from formula max(floor, round(sales×labour%/21)). */
  formulaHeadcount: z.number().int().optional(),
  /** Workers above floor — demand phase only. */
  extraWorkers: z.number().int().optional(),
  floorRoles: HourlyRoleCounts.optional(),
  extraRoles: HourlyRoleCounts.optional(),
  roles: HourlyRoleCounts.optional(),
});

export const WorkersNeededDay = z.object({
  date: z.string(),
  sales: z.number(),
  workers: z.number().int(),
  mandatoryFloor: z.number().int().optional(),
  formulaHeadcount: z.number().int().optional(),
  extraWorkers: z.number().int().optional(),
});

export const WorkersNeeded = z.object({
  byHour: z.array(WorkersNeededHour),
  byDay: z.array(WorkersNeededDay),
});

export const ScheduleShiftInput = z.object({
  employeeId: z.string().uuid(),
  day: z.string(),
  shiftDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  role: z.string(),
  location: z.string().optional(),
});

export const ScheduleShift = ScheduleShiftInput.extend({
  id: z.string().uuid(),
  isEngineSuggested: z.boolean().optional(),
  llmReasoning: z.string().nullable().optional(),
  isLocked: z.boolean().optional(),
});

export const ScheduleFlag = z.object({
  type: z.string(),
  date: z.string().optional(),
  hour: z.number().int().optional(),
  message: z.string().optional(),
});

export const GenerateScheduleRequest = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const SchedulingPrior = z.object({
  weeks_trained: z.number().int().optional(),
  shifts_learned: z.number().int().optional(),
  shift_templates: z
    .array(z.object({ start: z.string(), end: z.string(), weight: z.number() }))
    .optional(),
  dow_multiplier: z.record(z.number()).optional(),
  hour_multiplier: z.record(z.number()).optional(),
  employee_priors: z.record(z.unknown()).optional(),
  guidance: z.array(z.string()).optional(),
});

export const GenerateScheduleResponse = z.object({
  scheduleId: z.string().uuid(),
  status: ScheduleStatus,
  workersNeeded: WorkersNeeded,
  shifts: z.array(ScheduleShift),
  flags: z.array(ScheduleFlag),
  /** Learned patterns from historical schedules (shape hints, not copied shifts). */
  schedulingPrior: SchedulingPrior.optional(),
});

export const ScheduleDetail = z.object({
  id: z.string().uuid(),
  workplaceId: z.string().uuid(),
  weekStart: z.string(),
  status: ScheduleStatus,
  mlMetadata: z.record(z.unknown()),
  shifts: z.array(ScheduleShift),
  lastSalesSyncAt: z.string().nullable(),
  exportedAt: z.string().nullable(),
});

export const UpdateShiftRequest = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  isLocked: z.boolean().optional(),
});

export const PublishScheduleResponse = z.object({
  schedule: ScheduleDetail,
  downloadUrl: z.string(),
});

export const OverrideShiftRequestSchema = z.object({
  overrideReason: z.enum([
    "new_permanent_preference",
    "one_time_exception",
    "event_special_occasion",
    "fixing_ai_mistake",
  ]),
  notes: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  role: z.string().optional(),
  employeeId: z.string().uuid().optional(),
});

export const CLEARVIEW_EXPORT_COLUMNS = [
  "EmployeeNumber",
  "WorkDate",
  "Department",
  "JobCode",
  "RegularHours",
  "ShiftStart",
  "ShiftEnd",
  "StoreCode",
] as const;

export type GenerateScheduleRequest = z.infer<typeof GenerateScheduleRequest>;
export type GenerateScheduleResponse = z.infer<typeof GenerateScheduleResponse>;
export type ScheduleDetail = z.infer<typeof ScheduleDetail>;
export type OverrideShiftRequest = z.infer<typeof OverrideShiftRequestSchema>;
