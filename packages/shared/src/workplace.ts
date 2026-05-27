import { z } from "zod";

export const WorkplacePreferences = z.object({
  labourCostPct: z.number().min(0).max(1).default(0.2),
  avgHourlyWage: z.number().positive().optional(),
  constraints: z.record(z.unknown()).default({}),
  shiftLengthHours: z.number().positive().default(8),
  jobCodeMapping: z.record(z.string()).default({}),
});

export const CreateWorkplaceRequest = z.object({
  name: z.string().min(1),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  timezone: z.string().optional(),
  clearviewStoreCode: z.string().optional(),
  preferences: WorkplacePreferences.optional(),
});

export const UpdateWorkplacePreferencesRequest = z.object({
  preferences: WorkplacePreferences,
  clearviewStoreCode: z.string().optional(),
});

export const Workplace = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  clearviewStoreCode: z.string().nullable(),
  preferences: WorkplacePreferences,
  createdAt: z.string(),
});

export type WorkplacePreferences = z.infer<typeof WorkplacePreferences>;
export type CreateWorkplaceRequest = z.infer<typeof CreateWorkplaceRequest>;
export type Workplace = z.infer<typeof Workplace>;
