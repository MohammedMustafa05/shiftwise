import { Router } from "express";
import {
  UpdateAvailabilityRequest,
  UpdateEmployeeProfileRequest,
} from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";

export const employeesRouter = Router();

employeesRouter.use(authMiddleware);

employeesRouter.put(
  "/:id/profile",
  requireRole("EMPLOYER"),
  async (req, res, next) => {
    try {
      const body = UpdateEmployeeProfileRequest.parse(req.body);
      const profile = await query<{ workplace_id: string }>(
        `SELECT workplace_id FROM employee_profiles WHERE id = $1`,
        [req.params.id]
      );
      if (profile.rows.length === 0) throw httpError(404, "Employee not found");
      if (profile.rows[0].workplace_id !== req.auth?.workplaceId) {
        throw httpError(403, "Forbidden");
      }

      await query(
        `UPDATE employee_profiles SET
           role = COALESCE($2, role),
           employee_number = COALESCE($3, employee_number),
           payroll_department = COALESCE($4, payroll_department),
           job_code = COALESCE($5, job_code),
           rush_hour_suitability = COALESCE($6, rush_hour_suitability),
           performance_level = COALESCE($7, performance_level),
           reliability_score = COALESCE($8, reliability_score),
           updated_at = now()
         WHERE id = $1`,
        [
          req.params.id,
          body.role ?? null,
          body.employeeNumber ?? null,
          body.payrollDepartment ?? null,
          body.jobCode ?? null,
          body.rushHourSuitability ?? null,
          body.performanceLevel ?? null,
          body.reliabilityScore ?? null,
        ]
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

employeesRouter.put(
  "/:id/availability",
  requireRole("EMPLOYEE"),
  async (req, res, next) => {
    try {
      if (req.auth?.sub !== req.params.id && req.auth?.role !== "EMPLOYER") {
        throw httpError(403, "Forbidden");
      }
      const body = UpdateAvailabilityRequest.parse(req.body);
      const userId = req.auth?.role === "EMPLOYEE" ? req.auth.sub : req.params.id;

      await query(`DELETE FROM employee_availability WHERE user_id = $1`, [userId]);
      for (const block of body.blocks) {
        await query(
          `INSERT INTO employee_availability (user_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)`,
          [userId, block.dayOfWeek, block.startTime, block.endTime]
        );
      }
      res.json({ ok: true, blocks: body.blocks.length });
    } catch (e) {
      next(e);
    }
  }
);

employeesRouter.get("/me/schedule", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const week = String(req.query.week ?? "");
    const params: unknown[] = [req.auth!.sub, req.auth!.workplaceId];
    let weekFilter = "";
    if (week) {
      weekFilter = "AND s.week_start = $3";
      params.push(week);
    }

    const result = await query(
      `SELECT ss.id, ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role, ss.location,
              s.week_start, w.name AS workplace_name
       FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       JOIN workplaces w ON w.id = s.workplace_id
       WHERE ss.employee_id = $1 AND s.workplace_id = $2 AND s.status = 'published'
       ${weekFilter}
       ORDER BY ss.shift_date, ss.start_time`,
      params
    );

    res.json({
      weekStart: week || result.rows[0]?.week_start?.toString().slice(0, 10) || null,
      shifts: result.rows.map((r) => ({
        id: r.id,
        shiftDate:
          r.shift_date instanceof Date
            ? r.shift_date.toISOString().slice(0, 10)
            : String(r.shift_date).slice(0, 10),
        startTime: r.start_time.slice(0, 5),
        endTime: r.end_time.slice(0, 5),
        role: r.role,
        location: r.location,
        workplaceName: r.workplace_name,
      })),
    });
  } catch (e) {
    next(e);
  }
});
