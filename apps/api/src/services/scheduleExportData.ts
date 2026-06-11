import os from "os";
import path from "path";
import { query } from "../db/pool.js";
import { httpError } from "../middleware/errorHandler.js";
import { displayNameFromProfile } from "../utils/employeeMap.js";
import {
  exportScheduleToPDF,
  formatEmployeeDisplayName,
  type ScheduleExportData,
} from "./scheduleExporter.js";

type ShiftRow = {
  shift_date: Date | string;
  start_time: string;
  end_time: string;
  role: string;
  user_id: string;
  name: string | null;
  profile_data: Record<string, unknown> | null;
};

export async function buildScheduleExportData(
  scheduleId: string,
  workplaceId: string
): Promise<ScheduleExportData> {
  const sched = await query<{ week_start: Date | string; name: string; clearview_store_code: string | null }>(
    `SELECT s.week_start, w.name, w.clearview_store_code
     FROM schedules s
     JOIN workplaces w ON w.id = s.workplace_id
     WHERE s.id = $1 AND s.workplace_id = $2`,
    [scheduleId, workplaceId]
  );
  if (sched.rows.length === 0) throw httpError(404, "Schedule not found");

  const weekStartRaw = sched.rows[0].week_start;
  const weekStart =
    weekStartRaw instanceof Date
      ? weekStartRaw.toISOString().slice(0, 10)
      : String(weekStartRaw).slice(0, 10);

  const weekEndDate = new Date(`${weekStart}T12:00:00Z`);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const weekEndStr = weekEndDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const shifts = await query<ShiftRow>(
    `SELECT ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role,
            ss.employee_id AS user_id, u.name, ep.profile_data
     FROM schedule_shifts ss
     JOIN users u ON u.id = ss.employee_id
     LEFT JOIN employee_profiles ep ON ep.user_id = ss.employee_id
     WHERE ss.schedule_id = $1
     ORDER BY u.name, ss.shift_date, ss.start_time`,
    [scheduleId]
  );

  const roster = await query<{ user_id: string; name: string | null; profile_data: Record<string, unknown> | null }>(
    `SELECT ep.user_id, u.name, ep.profile_data
     FROM employee_profiles ep
     JOIN users u ON u.id = ep.user_id
     WHERE ep.workplace_id = $1
     ORDER BY u.name`,
    [workplaceId]
  );

  const employeeMap = new Map<string, { name: string; isBold: boolean }>();

  for (const r of roster.rows) {
    const display = formatEmployeeDisplayName(displayNameFromProfile(r.name ?? "", r.profile_data ?? {}));
    const pd = r.profile_data ?? {};
    const isBold = pd.experienceLevel === "Veteran" || pd.shiftTier === "Rush-capable";
    employeeMap.set(r.user_id, { name: display, isBold: Boolean(isBold) });
  }

  for (const s of shifts.rows) {
    if (employeeMap.has(s.user_id)) continue;
    const pd = s.profile_data ?? {};
    employeeMap.set(s.user_id, {
      name: formatEmployeeDisplayName(displayNameFromProfile(s.name ?? "", pd)),
      isBold: pd.experienceLevel === "Veteran" || pd.shiftTier === "Rush-capable",
    });
  }

  const employees = [...employeeMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const exportShifts = shifts.rows.map((s) => ({
    employee_name: formatEmployeeDisplayName(displayNameFromProfile(s.name ?? "", s.profile_data ?? {})),
    date:
      s.shift_date instanceof Date
        ? s.shift_date.toISOString().slice(0, 10)
        : String(s.shift_date).slice(0, 10),
    start_time: s.start_time.slice(0, 5),
    end_time: s.end_time.slice(0, 5),
    role: s.role,
  }));

  return {
    location_code: sched.rows[0].clearview_store_code ?? "6412",
    location_name: sched.rows[0].name,
    week_end_date: weekEndStr,
    week_start_date: weekStart,
    employees,
    shifts: exportShifts,
  };
}

export async function writeSchedulePdfToTemp(
  scheduleId: string,
  workplaceId: string
): Promise<string> {
  const data = await buildScheduleExportData(scheduleId, workplaceId);
  const tmpPath = path.join(os.tmpdir(), `schedule_${scheduleId}.pdf`);
  await exportScheduleToPDF(data, tmpPath);
  return tmpPath;
}
