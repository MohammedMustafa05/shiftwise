import { Router } from "express";
import { UpdateApprovalStatusRequest } from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { logActivity } from "../services/activityService.js";
import { formatDate } from "../utils/dates.js";

function toIsoDate(val: unknown): string {
  if (val instanceof Date) return formatDate(val);
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatDate(d);
  return s.slice(0, 10);
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
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        employeeId: r.user_id,
        employeeName: r.name,
        weekStart: toIsoDate(r.week_start),
        availabilityGrid: r.availability_grid,
        status: r.status,
        submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at,
      }))
    );
  } catch (e) {
    next(e);
  }
});

approvalsRouter.patch("/availability/:id", async (req, res, next) => {
  try {
    const body = UpdateApprovalStatusRequest.parse(req.body);
    const workplaceId = req.auth!.workplaceId!;
    const updated = await query<{ user_id: string }>(
      `UPDATE availability_submissions SET status = $2, reviewed_at = now(), reviewed_by = $3
       WHERE id = $1 AND workplace_id = $4
       RETURNING user_id`,
      [req.params.id, body.status, req.auth!.sub, workplaceId]
    );
    if (updated.rows.length === 0) throw httpError(404, "Request not found");
    const user = await query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
      updated.rows[0].user_id,
    ]);
    await logActivity(
      workplaceId,
      "employee_approved",
      `${body.status === "approved" ? "Approved" : "Rejected"} availability for ${user.rows[0]?.name ?? "employee"}`,
      req.auth!.email
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
      `SELECT t.id, t.user_id, t.start_date, t.end_date, t.reason, t.status, t.submitted_at, u.name
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
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
