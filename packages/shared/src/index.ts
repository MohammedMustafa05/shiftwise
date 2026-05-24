import { z } from "zod";

export const UserRole = z.enum(["EMPLOYER", "EMPLOYEE"]);
export type UserRole = z.infer<typeof UserRole>;

export const HealthResponse = z.object({
  status: z.string(),
  service: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
