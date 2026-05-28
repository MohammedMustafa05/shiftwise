import type {
  EngineGenerateRequest,
  EngineGenerateResponse,
  GenerateScheduleResponse,
} from "@shiftwise/shared";
import { config } from "../config.js";
import {
  generateLocalSchedule,
  type ScheduleAvailability,
  type ScheduleEmployee,
} from "./localScheduleGenerator.js";
import type { WorkplacePreferences } from "@shiftwise/shared";

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

function mapEngineResponse(
  data: EngineGenerateResponse,
  scheduleIdPlaceholder: string
): Omit<GenerateScheduleResponse, "scheduleId"> & { scheduleId?: string } {
  return {
    scheduleId: scheduleIdPlaceholder,
    status: data.status ?? "draft",
    workersNeeded: data.workers_needed,
    shifts: data.shifts.map((s) => ({
      id: crypto.randomUUID(),
      employeeId: s.employeeId,
      day: s.day,
      shiftDate: s.shiftDate,
      startTime: s.startTime,
      endTime: s.endTime,
      role: s.role,
      location: s.location ?? "Main",
    })),
    flags: data.flags ?? [],
  };
}

function payloadToLocalInputs(payload: EngineGenerateRequest): {
  employees: ScheduleEmployee[];
  availability: ScheduleAvailability[];
  preferences: WorkplacePreferences;
  operatingHours: { open: string; close: string };
} {
  const constraints = (payload.preferences.constraints ?? {}) as Record<string, unknown>;
  const employees: ScheduleEmployee[] = payload.employees.map((e) => ({
    userId: e.user_id,
    role: e.role,
    maxHoursPerWeek: e.max_hours ?? (constraints.maxHoursPerWeek as number) ?? 45,
  }));
  const availability: ScheduleAvailability[] = payload.availability.map((a) => ({
    userId: a.user_id,
    dayOfWeek: a.day_of_week,
    startTime: a.start_time,
    endTime: a.end_time,
  }));
  return {
    employees,
    availability,
    preferences: payload.preferences,
    operatingHours: payload.operating_hours.default,
  };
}

export async function callMlEngine(
  payload: EngineGenerateRequest
): Promise<Omit<GenerateScheduleResponse, "scheduleId">> {
  try {
    const res = await fetch(`${config.mlEngineUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = (await res.json()) as EngineGenerateResponse & {
        workersNeeded?: EngineGenerateResponse["workers_needed"];
        status?: string;
      };
      if (data.workersNeeded && !data.workers_needed) {
        data.workers_needed = data.workersNeeded;
      }
      const status = (data as { status?: string }).status;
      if (status !== "not_implemented" && data.workers_needed?.byHour) {
        const mapped = mapEngineResponse(data, "");
        const { scheduleId: _s, ...rest } = mapped;
        return rest;
      }
    }
  } catch (err) {
    console.warn("[mlClient] ML engine unavailable, using local fallback:", err);
  }

  const { employees, availability, preferences, operatingHours } = payloadToLocalInputs(payload);
  const local = generateLocalSchedule(
    payload.week_start,
    preferences,
    operatingHours,
    employees,
    availability
  );
  const labourPct = preferences.labourCostPct ?? 0.2;
  const avgWage = preferences.avgHourlyWage ?? 18.5;
  const byHour = payload.sales.map((s) => ({
    date: s.date,
    hour: s.hour,
    sales: s.sales_amount,
    workers: s.sales_amount > 0 ? Math.max(1, Math.ceil((s.sales_amount * labourPct) / avgWage)) : 0,
  }));
  const dayMap = new Map<string, { sales: number; workers: number }>();
  for (const h of byHour) {
    const cur = dayMap.get(h.date) ?? { sales: 0, workers: 0 };
    cur.sales += h.sales;
    cur.workers = Math.max(cur.workers, h.workers);
    dayMap.set(h.date, cur);
  }
  const byDay = [...dayMap.entries()].map(([date, v]) => ({
    date,
    sales: v.sales,
    workers: v.workers,
  }));
  return {
    ...local,
    workersNeeded: { byHour, byDay },
  };
}

export function enrichMlMetadata(
  mlResult: Omit<GenerateScheduleResponse, "scheduleId">,
  extras?: {
    engineVersion?: string;
    roleDemandByHour?: unknown;
    salesReferenceWeekStart?: string;
    salesReferenceWeekEnd?: string;
    labourCostPct?: number;
    avgHourlyWage?: number;
    roleRequirementsConfigured?: boolean;
  }
): Record<string, unknown> {
  return {
    workersNeeded: mlResult.workersNeeded,
    flags: mlResult.flags,
    engineVersion: extras?.engineVersion ?? "local-fallback",
    roleDemandByHour: extras?.roleDemandByHour,
    salesReferenceWeekStart: extras?.salesReferenceWeekStart,
    salesReferenceWeekEnd: extras?.salesReferenceWeekEnd,
    labourCostPct: extras?.labourCostPct,
    avgHourlyWage: extras?.avgHourlyWage,
    roleRequirementsConfigured: extras?.roleRequirementsConfigured,
  };
}

export { DAY_NAMES };
