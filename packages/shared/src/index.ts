import { z } from "zod";

export * from "./roles.js";
export * from "./auth.js";
export * from "./workplace.js";
export * from "./sales.js";
export * from "./schedule.js";
export * from "./employee.js";
export * from "./clearview.js";
export * from "./integrations.js";

export const HealthResponse = z.object({
  status: z.string(),
  service: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
