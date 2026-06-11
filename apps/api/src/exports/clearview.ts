import fs from "fs";
import path from "path";
import { CLEARVIEW_EXPORT_COLUMNS } from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { parseTimeToHours } from "../utils/dates.js";
import { httpError } from "../middleware/errorHandler.js";

interface ShiftRow {
  employee_number: string | null;
  payroll_department: string | null;
  job_code: string | null;
  shift_date: Date;
  start_time: string;
  end_time: string;
  role: string;
  clearview_store_code: string | null;
}

export async function buildClearviewCsv(scheduleId: string): Promise<string> {
  const shifts = await query<ShiftRow>(
    `SELECT ep.employee_number, ep.payroll_department, ep.job_code,
            ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role,
            w.clearview_store_code
     FROM schedule_shifts ss
     JOIN employee_profiles ep ON ep.user_id = ss.employee_id
     JOIN schedules s ON s.id = ss.schedule_id
     JOIN workplaces w ON w.id = s.workplace_id
     WHERE ss.schedule_id = $1
     ORDER BY ss.shift_date, ss.start_time`,
    [scheduleId]
  );

  const missing = shifts.rows.filter((r) => !r.employee_number);
  if (missing.length > 0) {
    throw httpError(
      400,
      `Missing employee_number for ${missing.length} assigned shift(s). Fill payroll IDs before publish.`
    );
  }

  // Deduplicate: same employee + date + start time should only appear once in the export.
  // If duplicates slipped into the DB (e.g. different roles, same time), keep the first row.
  const seen = new Set<string>();
  const dedupedShifts = shifts.rows.filter((s) => {
    const workDate =
      s.shift_date instanceof Date
        ? s.shift_date.toISOString().slice(0, 10)
        : String(s.shift_date).slice(0, 10);
    const key = `${s.employee_number}|${workDate}|${s.start_time.slice(0, 5)}|${s.end_time.slice(0, 5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const lines = [CLEARVIEW_EXPORT_COLUMNS.join(",")];
  for (const s of dedupedShifts) {
    const workDate =
      s.shift_date instanceof Date
        ? s.shift_date.toISOString().slice(0, 10)
        : String(s.shift_date).slice(0, 10);
    const hours = parseTimeToHours(s.start_time.slice(0, 5), s.end_time.slice(0, 5));
    lines.push(
      [
        s.employee_number,
        workDate,
        s.payroll_department ?? "",
        s.job_code ?? s.role,
        hours.toFixed(2),
        s.start_time.slice(0, 5),
        s.end_time.slice(0, 5),
        s.clearview_store_code ?? "STORE-001",
      ].join(",")
    );
  }
  return lines.join("\n");
}

export async function writeClearviewExportFile(
  scheduleId: string,
  exportsDir: string
): Promise<string> {
  const csv = await buildClearviewCsv(scheduleId);
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  const filename = `clearview-schedule-${scheduleId}.csv`;
  const filePath = path.join(exportsDir, filename);
  fs.writeFileSync(filePath, csv, "utf8");
  return filePath;
}
