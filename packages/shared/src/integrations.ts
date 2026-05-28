import { z } from "zod";

export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);

export const EmployeeProfileData = z.object({
  preferredName: z.string().optional(),
  phone: z.string().optional(),
  roles: z.array(z.string()).optional(),
  experienceLevel: z.string().optional(),
  shiftTier: z.string().optional(),
  minHours: z.number().optional(),
  maxHours: z.number().optional(),
  minShiftsPerWeek: z.number().optional(),
  maxShiftsPerWeek: z.number().optional(),
  employeeType: z.string().optional(),
  pairingAlwaysWith: z.array(z.string()).optional(),
  pairingNeverWith: z.array(z.string()).optional(),
});

export const WebEmployee = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  role: z.array(z.string()),
  experienceLevel: z.string(),
  shiftTier: z.string(),
  minHours: z.number(),
  maxHours: z.number(),
  minShiftsPerWeek: z.number().optional(),
  maxShiftsPerWeek: z.number().optional(),
  employeeType: z.string(),
  pairingAlwaysWith: z.array(z.string()),
  pairingNeverWith: z.array(z.string()),
  createdAt: z.string(),
});

export const CreateEmployeeRequest = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  phone: z.string().optional(),
  role: z.array(z.string()).optional(),
  experienceLevel: z.string().optional(),
  shiftTier: z.string().optional(),
  minHours: z.number().optional(),
  maxHours: z.number().optional(),
  minShiftsPerWeek: z.number().optional(),
  maxShiftsPerWeek: z.number().optional(),
  employeeType: z.string().optional(),
});

export const UpdateWebEmployeeRequest = CreateEmployeeRequest.partial();

export const AvailabilitySubmission = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeName: z.string(),
  weekStart: z.string(),
  availabilityGrid: z.record(z.array(z.string())),
  status: ApprovalStatus,
  submittedAt: z.string(),
});

export const TimeOffRequestItem = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeName: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string(),
  status: ApprovalStatus,
  submittedAt: z.string(),
});

export const UpdateApprovalStatusRequest = z.object({
  status: ApprovalStatus,
});

export const HourlySalesDay = z.object({
  date: z.string(),
  hourlySales: z.record(z.number()),
});

export const UpdateSalesRequest = z.object({
  weekStart: z.string(),
  days: z.array(HourlySalesDay),
});

export const OperatingHoursDay = z.object({
  open: z.string(),
  close: z.string(),
  closed: z.boolean().optional(),
});

export const WebPreferences = z.object({
  laborCostTarget: z.number(),
  maxConsecutiveDays: z.number(),
  minAvailabilityHours: z.number(),
  maxHoursPerWeek: z.number(),
  roleRequirements: z.record(z.array(z.object({
    from: z.string(),
    to: z.string(),
    cashiers: z.number(),
    cooks: z.number(),
    packliners: z.number(),
  }))),
  operatingHours: z.object({ open: z.string(), close: z.string() }),
  operatingHoursByDay: z.record(OperatingHoursDay).optional(),
});

export const UpdateWebPreferencesRequest = WebPreferences;

export const CreateShiftRequest = z.object({
  employeeId: z.string().uuid(),
  shiftDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  role: z.string(),
  location: z.string().optional(),
  isLocked: z.boolean().optional(),
});

export const DashboardSummary = z.object({
  pendingApprovals: z.number(),
  scheduledHours: z.number(),
  laborCost: z.number(),
  laborBudget: z.number(),
  laborCostPct: z.number(),
  weekStart: z.string(),
});

export const ActivityItem = z.object({
  id: z.string().uuid(),
  type: z.string(),
  message: z.string(),
  timestamp: z.string(),
  actor: z.string().nullable(),
});

export const EmployeeMeResponse = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  role: z.string(),
  workplaceId: z.string().uuid(),
  workplaceName: z.string(),
  location: z.string().nullable(),
  employmentType: z.string().nullable(),
  startDate: z.string().nullable(),
});

export const EmployeeStatsResponse = z.object({
  shiftsThisWeek: z.number(),
  hoursThisWeek: z.number(),
  daysOff: z.number(),
  nextShift: z.object({
    shiftDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    role: z.string(),
    location: z.string().nullable(),
  }).nullable(),
});

export const TeamShift = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeName: z.string(),
  shiftDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  role: z.string(),
  dayIndex: z.number(),
});

export const TransferRequestItem = z.object({
  id: z.string().uuid(),
  fromUserId: z.string().uuid(),
  fromUserName: z.string(),
  toUserId: z.string().uuid(),
  shiftId: z.string().uuid(),
  shiftDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  role: z.string(),
  note: z.string(),
  status: z.enum(["pending", "accepted", "declined"]),
  createdAt: z.string().optional(),
  targetShiftId: z.string().uuid().nullable().optional(),
  targetShiftDate: z.string().nullable().optional(),
  targetStartTime: z.string().nullable().optional(),
  targetEndTime: z.string().nullable().optional(),
  targetRole: z.string().nullable().optional(),
});

export const CreateTransferRequest = z.object({
  shiftId: z.string().uuid(),
  toUserId: z.string().uuid(),
  note: z.string().optional(),
  targetShiftId: z.string().uuid().optional(),
});

export const RespondTransferRequest = z.object({
  status: z.enum(["accepted", "declined"]),
});

export const CreateOpenShiftRequest = z.object({
  shiftId: z.string().uuid(),
  note: z.string().optional(),
});

export const OpenShiftItem = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  postedById: z.string().uuid(),
  postedByName: z.string(),
  shiftDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  role: z.string(),
  note: z.string(),
  createdAt: z.string(),
});

export const SubmitAvailabilityRequest = z.object({
  weekStart: z.string().optional(),
  blocks: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string(),
    endTime: z.string(),
  })),
});
