import { z } from "zod";

export const UserRole = z.enum(["EMPLOYER", "EMPLOYEE"]);
export type UserRole = z.infer<typeof UserRole>;
