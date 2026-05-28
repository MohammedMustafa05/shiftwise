import type {
  GenerateScheduleResponse,
  HourlySalesRow,
  WorkplacePreferences,
} from "@shiftwise/shared";
import { AvailabilityBlock, EmployeeProfile } from "@shiftwise/shared";
import { z } from "zod";
import { config } from "../config.js";
import { addDays, formatDate, getWeekStart } from "../utils/dates.js";

const MlGeneratePayload = z.object({
  workplace_id: z.string(),
  week_start: z.string(),
  sales: z.array(z.object({ date: z.string(), hour: z.number(), sales_amount: z.number() })),
  preferences: z.record(z.unknown()),
  employees: z.array(z.record(z.unknown())),
  availability: z.array(z.record(z.unknown())),
});

/** In-process stub when ML engine unavailable (Plan 1). */
export function generateScheduleStub(
  workplaceId: string,
  weekStart: string,
  sales: HourlySalesRow[],
  preferences: WorkplacePreferences,
  employees: Array<{ userId: string; role: string }>,
  availability: z.infer<typeof AvailabilityBlock>[]
): GenerateScheduleResponse {
  const labourPct = preferences.labourCostPct ?? 0.2;
  const avgWage = preferences.avgHourlyWage ?? 18.5;
  const start = getWeekStart(new Date(`${weekStart}T12:00:00Z`));

  const byHour = sales.map((s) => {
    const budget = s.salesAmount * labourPct;
    const workers = Math.max(1, Math.ceil(budget / avgWage));
    return {
      date: s.date,
      hour: s.hour,
      sales: s.salesAmount,
      workers,
    };
  });

  const dayMap = new Map<string, { sales: number; workers: number }>();
  for (const h of byHour) {
    const cur = dayMap.get(h.date) ?? { sales: 0, workers: 0 };
    cur.sales += h.sales;
    cur.workers += h.workers;
    dayMap.set(h.date, cur);
  }
  const byDay = [...dayMap.entries()].map(([date, v]) => ({
    date,
    sales: v.sales,
    workers: Math.ceil((v.sales * labourPct) / avgWage),
  }));

  const shifts: GenerateScheduleResponse["shifts"] = [];
  const flags: GenerateScheduleResponse["flags"] = [];

  if (employees.length > 0) {
    for (let d = 0; d < 7; d++) {
      const shiftDate = formatDate(addDays(start, d));
      const emp = employees[d % employees.length];
      const blocks = availability.filter((a) => a.dayOfWeek === d);
      const startTime = blocks[0]?.startTime ?? "09:00";
      const endTime = blocks[0]?.endTime ?? "17:00";
      shifts.push({
        id: crypto.randomUUID(),
        employeeId: emp.userId,
        day: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][d],
        shiftDate,
        startTime,
        endTime,
        role: emp.role,
        location: "Main",
      });
    }
  } else {
    flags.push({ type: "understaffed", message: "No employees in roster" });
  }

  return {
    scheduleId: crypto.randomUUID(),
    status: "draft",
    workersNeeded: { byHour, byDay },
    shifts,
    flags,
  };
}

export async function callMlEngine(
  workplaceId: string,
  weekStart: string,
  sales: HourlySalesRow[],
  preferences: WorkplacePreferences,
  employees: z.infer<typeof EmployeeProfile>[],
  availability: z.infer<typeof AvailabilityBlock>[]
): Promise<GenerateScheduleResponse> {
  const payload = {
    workplace_id: workplaceId,
    week_start: weekStart,
    sales: sales.map((s) => ({
      date: s.date,
      hour: s.hour,
      sales_amount: s.salesAmount,
    })),
    preferences,
    employees,
    availability,
  };

  try {
    const res = await fetch(`${config.mlEngineUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status !== "not_implemented") {
        return data as GenerateScheduleResponse;
      }
    }
  } catch {
    /* fall through to stub */
  }

  return generateScheduleStub(
    workplaceId,
    weekStart,
    sales,
    preferences,
    employees.map((e) => ({ userId: e.userId, role: e.role })),
    availability
  );
}

export { MlGeneratePayload };
