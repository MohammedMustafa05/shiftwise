import { Router } from "express";
import {
  CreateTimeOffBody,
  UpdateAvailabilityRequest,
  UpdateEmployeeProfileRequest,
  UpdateMobileProfileRequest,
} from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { formatDate, getWeekStart, parseTimeToHours, toIsoDate } from "../utils/dates.js";
import { displayNameFromProfile, normalizeRole } from "../utils/employeeMap.js";
import {
  gridFromSelections,
  matchBlockFromTimes,
  selectionFromBlockInput,
  selectionsFromGrid,
  totalHoursFromSelections,
} from "../utils/availabilityBlocks.js";
import { getEmployeeAnnouncementsWithLegacy, markScheduleViewed } from "../services/announcementService.js";
import { markNotificationRead } from "../services/notificationService.js";

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
    const roles = Array.isArray(pd.roles) && pd.roles.length
      ? (pd.roles as string[]).map(normalizeRole)
      : [normalizeRole(r.role)];
    res.json({
      id: r.id,
      email: r.email,
      name: displayNameFromProfile(r.name, pd),
      preferredName: (pd.preferredName as string) ?? null,
      phone: (pd.phone as string) ?? r.phone,
      role: roles[0] ?? normalizeRole(r.role),
      roles,
      workplaceId: r.workplace_id,
      workplaceName: r.workplace_name,
      location: (pd.location as string) ?? r.workplace_name,
      employmentType: (pd.employeeType as string) ?? "Part Time",
      fullDayCapable: pd.fullDayCapable === true,
      startDate: r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : null,
    });
  } catch (e) {
    next(e);
  }
});

employeesRouter.patch("/me", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const body = UpdateMobileProfileRequest.parse(req.body);
    const userId = req.auth!.sub;
    if (body.phone !== undefined && body.phone !== "" && !/^\d+$/.test(body.phone)) {
      throw httpError(400, "Phone number must contain numbers only");
    }

    const current = await query<{ profile_data: Record<string, unknown> }>(
      `SELECT profile_data FROM employee_profiles WHERE user_id = $1`,
      [userId]
    );
    if (current.rows.length === 0) throw httpError(404, "Profile not found");
    const pd = { ...(current.rows[0].profile_data ?? {}) };
    if (body.preferredName !== undefined) pd.preferredName = body.preferredName;
    if (body.phone !== undefined) pd.phone = body.phone;

    await query(
      `UPDATE employee_profiles SET profile_data = $2::jsonb, updated_at = now() WHERE user_id = $1`,
      [userId, JSON.stringify(pd)]
    );
    if (body.phone !== undefined) {
      await query(`UPDATE users SET phone = $2, updated_at = now() WHERE id = $1`, [
        userId,
        body.phone || null,
      ]);
    }

    const me = await query(
      `SELECT u.id, u.email, u.name, u.phone, u.created_at, ep.role, ep.profile_data,
              w.id AS workplace_id, w.name AS workplace_name
       FROM users u
       JOIN employee_profiles ep ON ep.user_id = u.id
       JOIN workplaces w ON w.id = u.workplace_id
       WHERE u.id = $1`,
      [userId]
    );
    const r = me.rows[0];
    const merged = (r.profile_data ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(merged.roles) && merged.roles.length
      ? (merged.roles as string[]).map(normalizeRole)
      : [normalizeRole(r.role)];
    res.json({
      id: r.id,
      email: r.email,
      name: displayNameFromProfile(r.name, merged),
      preferredName: (merged.preferredName as string) ?? null,
      phone: (merged.phone as string) ?? r.phone,
      role: roles[0] ?? normalizeRole(r.role),
      roles,
      workplaceId: r.workplace_id,
      workplaceName: r.workplace_name,
      location: (merged.location as string) ?? r.workplace_name,
      employmentType: (merged.employeeType as string) ?? "Part Time",
      fullDayCapable: merged.fullDayCapable === true,
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
      days.add(toIsoDate(s.shift_date));
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
            shiftDate: toIsoDate(nextShift.rows[0].shift_date),
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
    const userId = req.auth!.sub;
    const weekStart = formatDate(getWeekStart(new Date()));
    const submission = await query<{ status: string; availability_grid: Record<string, unknown> }>(
      `SELECT status, availability_grid FROM availability_submissions
       WHERE user_id = $1 AND week_start = $2`,
      [userId, weekStart]
    );
    const managerApproved =
      submission.rows[0]?.status === "approved" ||
      (await query(
        `SELECT 1 FROM availability_submissions WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
        [userId]
      )).rows.length > 0;

    if (submission.rows[0]?.availability_grid) {
      const selections = selectionsFromGrid(submission.rows[0].availability_grid);
      res.json(
        selections.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          block: s.block,
          label: s.label,
          startTime: s.startTime,
          endTime: s.endTime,
          managerApproved,
          confirmed: submission.rows[0]?.status === "approved",
        }))
      );
      return;
    }

    const result = await query<{ day_of_week: number; start_time: string; end_time: string }>(
      `SELECT day_of_week, start_time::text, end_time::text FROM employee_availability WHERE user_id = $1 ORDER BY day_of_week`,
      [userId]
    );
    res.json(
      result.rows.map((r) => ({
        dayOfWeek: r.day_of_week,
        block: "morning",
        label: "Morning",
        startTime: r.start_time.slice(0, 5),
        endTime: r.end_time.slice(0, 5),
        managerApproved,
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
      if (block.block === "off") continue;
      await query(
        `INSERT INTO employee_availability (user_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [userId, block.dayOfWeek, block.startTime, block.endTime]
      );
    }

    const weekStart = formatDate(getWeekStart(new Date()));
    const selections = body.blocks.map((b) => {
      if (b.block) return selectionFromBlockInput(b.dayOfWeek, b.block);
      const matched = matchBlockFromTimes(b.dayOfWeek, b.startTime, b.endTime);
      if (matched) return selectionFromBlockInput(b.dayOfWeek, matched);
      return selectionFromBlockInput(b.dayOfWeek, "morning");
    });
    if (totalHoursFromSelections(selections) < 24) {
      throw httpError(400, "Minimum 24 hours of availability required");
    }
    const grid = gridFromSelections(selections);

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
    const body = CreateTimeOffBody.parse(req.body);
    const ins = await query<{ id: string }>(
      `INSERT INTO time_off_requests (user_id, workplace_id, start_date, end_date, reason, request_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
      [
        req.auth!.sub,
        req.auth!.workplaceId,
        body.startDate,
        body.endDate,
        body.reason ?? "",
        body.requestType,
      ]
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

    const scheduleMeta = await query<{ id: string; week_start: Date }>(
      `SELECT id, week_start FROM schedules
       WHERE workplace_id = $1 AND status = 'published'
       ${week ? "AND week_start = $2" : ""}
       ORDER BY updated_at DESC LIMIT 1`,
      week ? [req.auth!.workplaceId, week] : [req.auth!.workplaceId]
    );

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
      scheduleId: scheduleMeta.rows[0]?.id ?? null,
      weekStart: week || result.rows[0]?.week_start?.toString().slice(0, 10) || null,
      shifts: result.rows.map((r) => ({
        id: r.id,
        shiftDate: toIsoDate(r.shift_date),
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
    const items = await getEmployeeAnnouncementsWithLegacy(req.auth!.sub, req.auth!.workplaceId!);
    res.json(items);
  } catch (e) {
    next(e);
  }
});

employeesRouter.post("/me/announcements/:id/read", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const notificationId = String(req.params.id);
    if (notificationId.startsWith("schedule-")) {
      const scheduleId = notificationId.slice("schedule-".length);
      await markScheduleViewed(req.auth!.sub, scheduleId);
    } else {
      await markNotificationRead(req.auth!.sub, notificationId);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

employeesRouter.post("/me/schedule-viewed", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const scheduleId = String(req.body.scheduleId ?? "");
    if (!scheduleId) throw httpError(400, "scheduleId required");
    const { markScheduleViewed } = await import("../services/announcementService.js");
    await markScheduleViewed(req.auth!.sub, scheduleId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
