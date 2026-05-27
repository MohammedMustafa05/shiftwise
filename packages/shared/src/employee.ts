import { z } from "zod";

export const EmployeeProfile = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  workplaceId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  employeeNumber: z.string().nullable(),
  payrollDepartment: z.string().nullable(),
  jobCode: z.string().nullable(),
});

export const UpdateEmployeeProfileRequest = z.object({
  role: z.string().optional(),
  employeeNumber: z.string().optional(),
  payrollDepartment: z.string().optional(),
  jobCode: z.string().optional(),
  rushHourSuitability: z.number().min(0).max(1).optional(),
  performanceLevel: z.number().min(0).max(1).optional(),
  reliabilityScore: z.number().min(0).max(1).optional(),
});

export const AvailabilityBlock = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
});

export const UpdateAvailabilityRequest = z.object({
  blocks: z.array(AvailabilityBlock),
});

export const EmployeeScheduleResponse = z.object({
  weekStart: z.string(),
  shifts: z.array(
    z.object({
      id: z.string().uuid(),
      shiftDate: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      role: z.string(),
      location: z.string().nullable(),
      workplaceName: z.string(),
    })
  ),
});

export type AvailabilityBlock = z.infer<typeof AvailabilityBlock>;
export type EmployeeProfile = z.infer<typeof EmployeeProfile>;
