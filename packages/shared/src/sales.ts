import { z } from "zod";

export const HourlySalesRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hour: z.number().int().min(0).max(23),
  salesAmount: z.number().nonnegative(),
});

export const ClearviewSalesSyncResult = z.object({
  workplaceId: z.string().uuid(),
  weekStart: z.string(),
  weekEnd: z.string(),
  rowsUpserted: z.number().int(),
  mode: z.enum(["mock", "live"]),
  syncedAt: z.string(),
});

export const SalesDataUploadResponse = z.object({
  rowsAccepted: z.number().int(),
  rowsRejected: z.number().int(),
  dateRange: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
});

export type HourlySalesRow = z.infer<typeof HourlySalesRow>;
export type ClearviewSalesSyncResult = z.infer<typeof ClearviewSalesSyncResult>;
