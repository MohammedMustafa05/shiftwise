import { Router } from "express";
import { ApproveAvailabilityRequest, UpdateApprovalStatusRequest } from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { logActivity } from "../services/activityService.js";
import { createNotification } from "../services/notificationService.js";
import { formatDate } from "../utils/dates.js";
import { selectionsFromGrid, formatDayLabel, gridToHourlySlots } from "../utils/availabilityBlocks.js";

function toIsoDate(val: unknown): string {
  if (val instanceof Date) return formatDate(val);
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatDate(d);
  return s.slice(0, 10);
}

function formatBlockTimeRange(start: string, end: string): string {
  const fmt = (t: string) => {
    const [hStr, mStr] = t.slice(0, 5).split(":");
    let h = parseInt(hStr, 10);
    const m = mStr ?? "00";
    const ampm = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${ampm}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export const approvalsRouter = Router();

approvalsRouter.use(authMiddleware);
approvalsRouter.use(requireRole("EMPLOYER"));

approvalsRouter.get("/availability", async (req, res, next) => {
  try {
    const workplaceId = req.auth!.workplaceId!;
    const status = String(req.query.status ?? "");
    let statusFilter = "";
    const params: unknown[] = [workplaceId];
    if (status) {
      statusFilter = "AND a.status = $2";
      params.push(status);
    }
    const result = await query(
      `SELECT a.id, a.user_id, a.week_start, a.availability_grid, a.status, a.submitted_at, u.name
       FROM availability_submissions a
       JOIN users u ON u.id = a.user_id
       WHERE a.workplace_id = $1 ${statusFilter}
       ORDER BY a.submitted_at DESC`,
      params
    );

    const items = [];
    for (const r of result.rows) {
      const prof = await query<{ first_approval_completed: boolean }>(
        `SELECT first_approval_completed
         FROM employee_profiles
         WHERE user_id = $1 AND workplace_id = $2`,
        [r.user_id, workplaceId]
      );
      const firstApprovalCompleted = prof.rows[0]?.first_approval_completed === true;
      const selections = selectionsFromGrid(
        (r.availability_grid ?? {}) as Record<string, unknown>
      );
      const blockSummaries = selections.map((s) => ({
        day: formatDayLabel(s.dayOfWeek),
        block: s.label,
        timeRange: s.block === "off" ? "" : formatBlockTimeRange(s.startTime, s.endTime),
      }));

      items.push({
        id: r.id,
        employeeId: r.user_id,
        employeeName: r.name,
        weekStart: toIsoDate(r.week_start),
        availabilityGrid: gridToHourlySlots((r.availability_grid ?? {}) as Record<string, unknown>),
        availabilityBlocks: blockSummaries,
        status: r.status,
        submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at,
        isFirstApproval: !firstApprovalCompleted,
      });
    }
    res.json(items);
  } catch (e) {
    next(e);
  }
});

approvalsRouter.patch("/availability/:id", async (req, res, next) => {
  try {
    const body = ApproveAvailabilityRequest.parse(req.body);
    const workplaceId = req.auth!.workplaceId!;

    const existing = await query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM availability_submissions WHERE id = $1 AND workplace_id = $2`,
      [req.params.id, workplaceId]
    );
    if (existing.rows.length === 0) throw httpError(404, "Request not found");

    const prof = await query<{ first_approval_completed: boolean }>(
      `SELECT first_approval_completed
       FROM employee_profiles
       WHERE user_id = $1 AND workplace_id = $2`,
      [existing.rows[0].user_id, workplaceId]
    );
    const isFirstApproval = prof.rows[0]?.first_approval_completed !== true;

    if (body.status === "approved" && isFirstApproval) {
      await query(
        `UPDATE employee_profiles SET first_approval_completed = true, updated_at = now()
         WHERE user_id = $1 AND workplace_id = $2`,
        [existing.rows[0].user_id, workplaceId]
      );
    }

    const updated = await query<{ user_id: string }>(
      `UPDATE availability_submissions SET status = $2, reviewed_at = now(), reviewed_by = $3
       WHERE id = $1 AND workplace_id = $4
       RETURNING user_id`,
      [req.params.id, body.status, req.auth!.sub, workplaceId]
    );

    if (body.status === "approved") {
      const submission = await query<{ availability_grid: Record<string, unknown> }>(
        `SELECT availability_grid FROM availability_submissions WHERE id = $1`,
        [req.params.id]
      );
      const grid = submission.rows[0]?.availability_grid ?? {};
      const selections = selectionsFromGrid(grid);
      await query(`DELETE FROM employee_availability WHERE user_id = $1`, [updated.rows[0].user_id]);
      for (const s of selections) {
        if (s.block === "off") continue;
        await query(
          `INSERT INTO employee_availability (user_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)`,
          [updated.rows[0].user_id, s.dayOfWeek, s.startTime, s.endTime]
        );
      }
    }

    const user = await query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
      updated.rows[0].user_id,
    ]);
    await logActivity(
      workplaceId,
      "employee_approved",
      `${body.status === "approved" ? "Approved" : "Rejected"} availability for ${user.rows[0]?.name ?? "employee"}`,
      req.auth!.email
    );

    await createNotification(
      updated.rows[0].user_id,
      workplaceId,
      body.status === "approved" ? "availability_accepted" : "availability_rejected",
      body.status === "approved" ? "Your availability was approved" : "Your availability was rejected",
      "/(tabs)/availability",
      req.params.id
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

approvalsRouter.get("/time-off", async (req, res, next) => {
  try {
    const workplaceId = req.auth!.workplaceId!;
    const status = String(req.query.status ?? "");
    let statusFilter = "";
    const params: unknown[] = [workplaceId];
    if (status) {
      statusFilter = "AND t.status = $2";
      params.push(status);
    }
    const result = await query(
      `SELECT t.id, t.user_id, t.start_date, t.end_date, t.reason, t.request_type, t.status, t.submitted_at, u.name
       FROM time_off_requests t
       JOIN users u ON u.id = t.user_id
       WHERE t.workplace_id = $1 ${statusFilter}
       ORDER BY t.submitted_at DESC`,
      params
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        employeeId: r.user_id,
        employeeName: r.name,
        startDate: toIsoDate(r.start_date),
        endDate: toIsoDate(r.end_date),
        reason: r.reason,
        requestType: r.request_type,
        status: r.status,
        submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at,
      }))
    );
  } catch (e) {
    next(e);
  }
});

approvalsRouter.patch("/time-off/:id", async (req, res, next) => {
  try {
    const body = UpdateApprovalStatusRequest.parse(req.body);
    const workplaceId = req.auth!.workplaceId!;
    const updated = await query<{ user_id: string }>(
      `UPDATE time_off_requests SET status = $2, reviewed_at = now(), reviewed_by = $3
       WHERE id = $1 AND workplace_id = $4
       RETURNING user_id`,
      [req.params.id, body.status, req.auth!.sub, workplaceId]
    );
    if (updated.rows.length === 0) throw httpError(404, "Request not found");

    await createNotification(
      updated.rows[0].user_id,
      workplaceId,
      body.status === "approved" ? "time_off_accepted" : "time_off_rejected",
      body.status === "approved" ? "Time off request approved" : "Time off request rejected",
      "/request-time-off",
      req.params.id
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
