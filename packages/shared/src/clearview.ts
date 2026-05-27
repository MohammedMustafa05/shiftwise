import { z } from "zod";

export const ClearviewMode = z.enum(["mock", "live"]);

export const ClearviewConnectResponse = z.object({
  mode: ClearviewMode,
  connectUrl: z.string(),
});

export const ClearviewStatusResponse = z.object({
  connected: z.boolean(),
  mode: ClearviewMode,
  storeId: z.string().nullable(),
  lastSalesSyncAt: z.string().nullable(),
  lastSyncError: z.string().nullable(),
});

export type ClearviewConnectResponse = z.infer<typeof ClearviewConnectResponse>;
export type ClearviewStatusResponse = z.infer<typeof ClearviewStatusResponse>;
