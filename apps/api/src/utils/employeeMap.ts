import { EmployeeProfileData } from "@shiftwise/shared";
import type { z } from "zod";

type ProfileData = z.infer<typeof EmployeeProfileData>;

type ProfileRow = {
  id: string;
  user_id: string;
  role: string;
  profile_data: ProfileData | Record<string, unknown>;
  created_at: Date;
  name: string;
  email: string;
  phone: string | null;
};

export function mapWebEmployee(row: ProfileRow) {
  const pd = (row.profile_data ?? {}) as ProfileData;
  const roles = pd.roles?.length
    ? pd.roles
    : [normalizeRole(row.role)];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: pd.phone ?? row.phone ?? "",
    role: roles,
    experienceLevel: pd.experienceLevel ?? "Intermediate",
    shiftTier: pd.shiftTier ?? "Rush-capable",
    minHours: pd.minHours ?? 20,
    maxHours: pd.maxHours ?? 40,
    minShiftsPerWeek: pd.minShiftsPerWeek,
    maxShiftsPerWeek: pd.maxShiftsPerWeek,
    employeeType: pd.employeeType ?? "Part Time",
    pairingAlwaysWith: pd.pairingAlwaysWith ?? [],
    pairingNeverWith: pd.pairingNeverWith ?? [],
    createdAt: row.created_at.toISOString(),
  };
}

export function profileDataFromWebInput(body: Record<string, unknown>): ProfileData {
  return {
    preferredName: body.preferredName as string | undefined,
    phone: body.phone as string | undefined,
    roles: body.role as string[] | undefined,
    experienceLevel: body.experienceLevel as string | undefined,
    shiftTier: body.shiftTier as string | undefined,
    minHours: body.minHours as number | undefined,
    maxHours: body.maxHours as number | undefined,
    minShiftsPerWeek: body.minShiftsPerWeek as number | undefined,
    maxShiftsPerWeek: body.maxShiftsPerWeek as number | undefined,
    employeeType: body.employeeType as string | undefined,
    pairingAlwaysWith: body.pairingAlwaysWith as string[] | undefined,
    pairingNeverWith: body.pairingNeverWith as string[] | undefined,
  };
}

export function apiRoleFromWeb(roles: string[] | undefined): string {
  const r = roles?.[0] ?? "STAFF";
  const map: Record<string, string> = {
    Cook: "COOK",
    Cashier: "CASHIER",
    Packliner: "PACKLINER",
    COOK: "COOK",
    CASHIER: "CASHIER",
    PACKLINER: "PACKLINER",
  };
  return map[r] ?? r.toUpperCase();
}

export function normalizeRole(role: string): string {
  const map: Record<string, string> = {
    COOK: "Cook",
    CASHIER: "Cashier",
    PACKLINER: "Packliner",
    STAFF: "Cashier",
  };
  return map[role] ?? role;
}
