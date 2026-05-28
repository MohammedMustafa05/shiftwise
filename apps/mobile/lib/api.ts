import type { AuthResponse } from "@shiftwise/shared";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "shiftwise_token";
const USER_KEY = "shiftwise_user";

export type StoredUser = AuthResponse["user"];

/** Resolve API base URL for simulator, emulator, and physical device. */
export function resolveApiBase(): string {
  const fromExtra = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const configured = (fromExtra ?? fromEnv ?? "").replace(/\/$/, "");

  // Explicit LAN / staging URL — use as-is
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }

  // Same machine as Metro bundler (physical device on same Wi‑Fi)
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:3001/api`;
    }
  }

  if (Platform.OS === "android") {
    return "http://10.0.2.2:3001/api";
  }

  return configured || "http://localhost:3001/api";
}

export const API_BASE = resolveApiBase();

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getStoredUser(): Promise<StoredUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export async function setAuth(auth: AuthResponse): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, auth.token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(auth.user));
}

export async function clearAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (e) {
    const hint =
      Platform.OS === "android"
        ? " On Android emulator use 10.0.2.2; on a real device set EXPO_PUBLIC_API_URL in the repo root .env to your computer's LAN IP (e.g. http://192.168.1.10:3001/api)."
        : " On a physical device set EXPO_PUBLIC_API_URL in the repo root .env to your computer's LAN IP.";
    throw new Error(
      `Cannot reach API at ${API_BASE}.${hint} (${e instanceof Error ? e.message : "network error"})`
    );
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getMe: () =>
    apiFetch<{
      id: string;
      email: string;
      name: string;
      phone: string | null;
      role: string;
      workplaceId: string;
      workplaceName: string;
      location: string | null;
      employmentType: string | null;
      startDate: string | null;
    }>("/employees/me"),

  getStats: (week?: string) =>
    apiFetch<{
      shiftsThisWeek: number;
      hoursThisWeek: number;
      daysOff: number;
      nextShift: {
        shiftDate: string;
        startTime: string;
        endTime: string;
        role: string;
        location: string | null;
      } | null;
    }>(`/employees/me/stats${week ? `?week=${week}` : ""}`),

  getMySchedule: (week?: string) =>
    apiFetch<{
      weekStart: string;
      shifts: Array<{
        id: string;
        shiftDate: string;
        startTime: string;
        endTime: string;
        role: string;
        location: string | null;
        workplaceName: string;
      }>;
    }>(`/employees/me/schedule${week ? `?week=${week}` : ""}`),

  getTeamSchedule: (workplaceId: string, weekStart: string) =>
    apiFetch<
      Array<{
        id: string;
        employeeId: string;
        employeeName: string;
        shiftDate: string;
        startTime: string;
        endTime: string;
        role: string;
        dayIndex: number;
      }>
    >(`/workplace/${workplaceId}/team-schedule?weekStart=${weekStart}`),

  getAvailability: () =>
    apiFetch<
      Array<{
        day: string;
        dayOfWeek: number;
        from: string;
        to: string;
        managerApproved: boolean;
        confirmed: boolean;
      }>
    >("/employees/me/availability"),

  saveAvailability: (blocks: Array<{ dayOfWeek: number; startTime: string; endTime: string }>) =>
    apiFetch("/employees/me/availability", {
      method: "PUT",
      body: JSON.stringify({ blocks }),
    }),

  getCoworkers: () =>
    apiFetch<Array<{ id: string; name: string; role: string }>>("/transfers/coworkers"),

  getTransferRequests: () =>
    apiFetch<
      Array<{
        id: string;
        fromUserId: string;
        fromUserName: string;
        shiftId: string;
        shiftDate: string;
        startTime: string;
        endTime: string;
        role: string;
        note: string;
        status: string;
        createdAt?: string;
        targetShiftId?: string | null;
        targetShiftDate?: string | null;
        targetStartTime?: string | null;
        targetEndTime?: string | null;
        targetRole?: string | null;
      }>
    >("/transfers/me"),

  createTransfer: (
    shiftId: string,
    toUserId: string,
    options?: { note?: string; targetShiftId?: string },
  ) =>
    apiFetch("/transfers/me", {
      method: "POST",
      body: JSON.stringify({
        shiftId,
        toUserId,
        note: options?.note,
        targetShiftId: options?.targetShiftId,
      }),
    }),

  respondTransfer: (id: string, status: "accepted" | "declined") =>
    apiFetch(`/transfers/me/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),

  getOpenShifts: () =>
    apiFetch<
      Array<{
        id: string;
        shiftId: string;
        postedById: string;
        postedByName: string;
        shiftDate: string;
        startTime: string;
        endTime: string;
        role: string;
        note: string;
        createdAt: string;
      }>
    >("/open-shifts"),

  postOpenShift: (shiftId: string, note?: string) =>
    apiFetch("/open-shifts", {
      method: "POST",
      body: JSON.stringify({ shiftId, note }),
    }),

  claimOpenShift: (id: string) =>
    apiFetch(`/open-shifts/${id}/claim`, { method: "POST" }),

  getAnnouncements: () =>
    apiFetch<Array<{ id: string; title: string; date: string; type: string }>>(
      "/employees/me/announcements",
    ),
};
