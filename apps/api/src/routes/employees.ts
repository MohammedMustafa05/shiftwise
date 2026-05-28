import { Router } from "express";
import {
  UpdateAvailabilityRequest,
  UpdateEmployeeProfileRequest,
} from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { formatDate, getWeekStart, parseTimeToHours } from "../utils/dates.js";
import { normalizeRole } from "../utils/employeeMap.js";

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

employeesRouter.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.name, u.phone, u.created_at, ep.role, ep.profile_data,
              w.id AS workplace_id, w.name AS workplace_name
       FROM users u
       JOIN employee_profiles ep ON ep.user_id = u.id
       JOIN workplaces w ON w.id = u.workplace_id
       WHERE u.id = $1`,
      [req.auth!.sub]
    );
    if (result.rows.length === 0) throw httpError(404, "Profile not found");
    const r = result.rows[0];
    const pd = (r.profile_data ?? {}) as Record<string, unknown>;
    res.json({
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      role: normalizeRole(r.role),
      workplaceId: r.workplace_id,
      workplaceName: r.workplace_name,
      location: (pd.location as string) ?? r.workplace_name,
      employmentType: (pd.employeeType as string) ?? "Part Time",
      startDate: r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : null,
    });
  } catch (e) {
    next(e);
  }
});

employeesRouter.get("/me/stats", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const week = String(req.query.week ?? formatDate(getWeekStart(new Date())));
    const shifts = await query<{ shift_date: Date; start_time: string; end_time: string }>(
      `SELECT ss.shift_date, ss.start_time::text, ss.end_time::text
       FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       WHERE ss.employee_id = $1 AND s.week_start = $2 AND s.status = 'published'`,
      [req.auth!.sub, week]
    );
    let hours = 0;
    const days = new Set<string>();
    for (const s of shifts.rows) {
      hours += parseTimeToHours(s.start_time, s.end_time);
      days.add(String(s.shift_date).slice(0, 10));
    }
    const nextShift = await query(
      `SELECT ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role, ss.location
       FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       WHERE ss.employee_id = $1 AND s.status = 'published' AND ss.shift_date >= CURRENT_DATE
       ORDER BY ss.shift_date, ss.start_time LIMIT 1`,
      [req.auth!.sub]
    );
    res.json({
      shiftsThisWeek: shifts.rows.length,
      hoursThisWeek: Math.round(hours),
      daysOff: 7 - days.size,
      nextShift: nextShift.rows[0]
        ? {
            shiftDate: String(nextShift.rows[0].shift_date).slice(0, 10),
            startTime: nextShift.rows[0].start_time.slice(0, 5),
            endTime: nextShift.rows[0].end_time.slice(0, 5),
            role: normalizeRole(nextShift.rows[0].role),
            location: nextShift.rows[0].location,
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

employeesRouter.get("/me/availability", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const result = await query<{ day_of_week: number; start_time: string; end_time: string }>(
      `SELECT day_of_week, start_time::text, end_time::text FROM employee_availability WHERE user_id = $1 ORDER BY day_of_week`,
      [req.auth!.sub]
    );
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    res.json(
      result.rows.map((r) => ({
        day: days[r.day_of_week === 0 ? 6 : r.day_of_week - 1] ?? days[r.day_of_week],
        dayOfWeek: r.day_of_week,
        from: r.start_time.slice(0, 5),
        to: r.end_time.slice(0, 5),
        managerApproved: true,
        confirmed: true,
      }))
    );
  } catch (e) {
    next(e);
  }
});

employeesRouter.put("/me/availability", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    req.params = { ...req.params, id: req.auth!.sub };
    const body = UpdateAvailabilityRequest.parse(req.body);
    const userId = req.auth!.sub;
    const workplaceId = req.auth!.workplaceId!;

    await query(`DELETE FROM employee_availability WHERE user_id = $1`, [userId]);
    for (const block of body.blocks) {
      await query(
        `INSERT INTO employee_availability (user_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [userId, block.dayOfWeek, block.startTime, block.endTime]
      );
    }

    const weekStart = formatDate(getWeekStart(new Date()));
    const grid: Record<string, string[]> = {};
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (const block of body.blocks) {
      const key = days[block.dayOfWeek];
      grid[key] = grid[key] ?? [];
      grid[key].push(block.startTime, block.endTime);
    }

    await query(
      `INSERT INTO availability_submissions (user_id, workplace_id, week_start, availability_grid, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (user_id, week_start) DO UPDATE SET availability_grid = EXCLUDED.availability_grid, status = 'pending', submitted_at = now()`,
      [userId, workplaceId, weekStart, JSON.stringify(grid)]
    );

    res.json({ ok: true, blocks: body.blocks.length });
  } catch (e) {
    next(e);
  }
});

employeesRouter.post("/me/time-off", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const { startDate, endDate, reason } = req.body as {
      startDate: string;
      endDate: string;
      reason?: string;
    };
    if (!startDate || !endDate) throw httpError(400, "startDate and endDate required");
    const ins = await query<{ id: string }>(
      `INSERT INTO time_off_requests (user_id, workplace_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.auth!.sub, req.auth!.workplaceId, startDate, endDate, reason ?? ""]
    );
    res.status(201).json({ id: ins.rows[0].id });
  } catch (e) {
    next(e);
  }
});

employeesRouter.put(
  "/:id/availability",
  requireRole("EMPLOYEE"),
  async (req, res, next) => {
    try {
      if (req.auth?.sub !== req.params.id) {
        throw httpError(403, "Forbidden");
      }
      const body = UpdateAvailabilityRequest.parse(req.body);
      const userId = req.auth.sub;

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

employeesRouter.get("/me/announcements", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const workplaceId = req.auth!.workplaceId!;
    const limit = parseInt(String(req.query.limit ?? "10"), 10);
    const { getActivity } = await import("../services/activityService.js");
    const items = await getActivity(workplaceId, limit);
    res.json(
      items.map((item) => ({
        id: item.id,
        title: item.message,
        date: new Date(item.timestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        type: item.type,
      }))
    );
  } catch (e) {
    next(e);
  }
});
