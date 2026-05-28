import { z } from "zod";

export const ScheduleStatus = z.enum(["draft", "published"]);

export const WorkersNeededHour = z.object({
  date: z.string(),
  hour: z.number().int(),
  sales: z.number(),
  workers: z.number().int(),
});

export const WorkersNeededDay = z.object({
  date: z.string(),
  sales: z.number(),
  workers: z.number().int(),
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

export const GenerateScheduleResponse = z.object({
  scheduleId: z.string().uuid(),
  status: ScheduleStatus,
  workersNeeded: WorkersNeeded,
  shifts: z.array(ScheduleShift),
  flags: z.array(ScheduleFlag),
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
