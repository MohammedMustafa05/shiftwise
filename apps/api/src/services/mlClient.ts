import type {
  GenerateScheduleResponse,
  HourlySalesRow,
  WorkplacePreferences,
} from "@shiftagent/shared";
import { AvailabilityBlock, EmployeeProfile } from "@shiftagent/shared";
import { z } from "zod";
import { config } from "../config.js";
import { addDays, formatDate, getWeekStart } from "../utils/dates.js";
import {
  buildDailyDemandFromHourly,
  buildHourlyDemand,
} from "../utils/labourDemand.js";

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
  availability: Array<z.infer<typeof AvailabilityBlock> & { userId?: string }>
): GenerateScheduleResponse {
  const labourPct = preferences.labourCostPct ?? 0.2;
  const start = getWeekStart(new Date(`${weekStart}T12:00:00Z`));

  const byHour = buildHourlyDemand(
    sales.map((s) => ({ date: s.date, hour: s.hour, salesAmount: s.salesAmount })),
    labourPct
  );
  const byDay = buildDailyDemandFromHourly(byHour, labourPct);

  const shifts: GenerateScheduleResponse["shifts"] = [];
  const flags: GenerateScheduleResponse["flags"] = [];
  const employeesWithAvailability = new Set(
    availability.map((a) => a.userId).filter(Boolean) as string[]
  );
  const schedulableEmployees = employees.filter((e) => employeesWithAvailability.has(e.userId));

  if (schedulableEmployees.length > 0) {
    for (let d = 0; d < 7; d++) {
      const shiftDate = formatDate(addDays(start, d));
      const dow = new Date(`${shiftDate}T12:00:00Z`).getUTCDay();
      for (const emp of schedulableEmployees) {
        const blocks = availability.filter((a) => a.userId === emp.userId && a.dayOfWeek === dow);
        if (blocks.length === 0) continue;
        const block = blocks[0];
        shifts.push({
          id: crypto.randomUUID(),
          employeeId: emp.userId,
          day: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][dow],
          shiftDate,
          startTime: block.startTime,
          endTime: block.endTime,
          role: emp.role,
          location: "Main",
        });
      }
    }
  } else if (employees.length > 0) {
    flags.push({ type: "understaffed", message: "No employees with availability for this week" });
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
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.mlEngineApiKey) {
      headers["X-ML-Engine-Key"] = config.mlEngineApiKey;
    }
    const res = await fetch(`${config.mlEngineUrl}/generate`, {
      method: "POST",
      headers,
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
