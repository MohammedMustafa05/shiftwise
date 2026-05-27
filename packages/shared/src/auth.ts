import { z } from "zod";
import { UserRole } from "./roles.js";

export const SignupRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  workplaceName: z.string().min(1),
  timezone: z.string().optional(),
});

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const JoinRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRole,
  workplaceId: z.string().uuid().nullable(),
});

export const AuthResponse = z.object({
  token: z.string(),
  user: AuthUser,
});

export type SignupRequest = z.infer<typeof SignupRequest>;
export type LoginRequest = z.infer<typeof LoginRequest>;
export type JoinRequest = z.infer<typeof JoinRequest>;
export type AuthUser = z.infer<typeof AuthUser>;
export type AuthResponse = z.infer<typeof AuthResponse>;
