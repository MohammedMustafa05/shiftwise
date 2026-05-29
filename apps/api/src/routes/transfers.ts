import { Router } from "express";
import { CreateTransferRequest, RespondTransferRequest } from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { logActivity } from "../services/activityService.js";
import { createNotification } from "../services/notificationService.js";
import { toIsoDate } from "../utils/dates.js";

export const transfersRouter = Router();

transfersRouter.use(authMiddleware);

transfersRouter.get("/me", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const userId = req.auth!.sub;
    const result = await query(
      `SELECT st.id, st.from_user_id, st.to_user_id, st.shift_id, st.target_shift_id, st.note, st.status, st.created_at,
              ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role,
              ts.shift_date AS target_shift_date, ts.start_time::text AS target_start_time,
              ts.end_time::text AS target_end_time, ts.role AS target_role,
              fu.name AS from_name
       FROM shift_transfers st
       JOIN schedule_shifts ss ON ss.id = st.shift_id
       JOIN users fu ON fu.id = st.from_user_id
       LEFT JOIN schedule_shifts ts ON ts.id = st.target_shift_id
       WHERE st.to_user_id = $1 AND st.status = 'pending'
       ORDER BY st.created_at DESC`,
      [userId]
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        fromUserId: r.from_user_id,
        fromUserName: r.from_name,
        toUserId: r.to_user_id,
        shiftId: r.shift_id,
        shiftDate: toIsoDate(r.shift_date),
        startTime: r.start_time.slice(0, 5),
        endTime: r.end_time.slice(0, 5),
        role: r.role,
        note: r.note,
        status: r.status,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        targetShiftId: r.target_shift_id ?? null,
        targetShiftDate: r.target_shift_date ? toIsoDate(r.target_shift_date) : null,
        targetStartTime: r.target_start_time ? r.target_start_time.slice(0, 5) : null,
        targetEndTime: r.target_end_time ? r.target_end_time.slice(0, 5) : null,
        targetRole: r.target_role ?? null,
      }))
    );
  } catch (e) {
    next(e);
  }
});

transfersRouter.post("/me", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const body = CreateTransferRequest.parse(req.body);
    const fromUserId = req.auth!.sub;

    const shift = await query<{ employee_id: string }>(
      `SELECT ss.employee_id FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       WHERE ss.id = $1 AND s.status = 'published'`,
      [body.shiftId]
    );
    if (shift.rows.length === 0) throw httpError(404, "Shift not found");
    if (shift.rows[0].employee_id !== fromUserId) {
      throw httpError(403, "You can only transfer your own shifts");
    }

    if (body.targetShiftId) {
      const target = await query<{ employee_id: string }>(
        `SELECT ss.employee_id FROM schedule_shifts ss
         JOIN schedules s ON s.id = ss.schedule_id
         WHERE ss.id = $1 AND s.status = 'published'`,
        [body.targetShiftId]
      );
      if (target.rows.length === 0) throw httpError(404, "Coworker shift not found");
      if (target.rows[0].employee_id !== body.toUserId) {
        throw httpError(400, "Selected coworker shift does not belong to that coworker");
      }
    }

    const openPost = await query(
      `SELECT id FROM open_shift_posts WHERE shift_id = $1 AND status = 'open' LIMIT 1`,
      [body.shiftId]
    );
    if (openPost.rows.length > 0) {
      throw httpError(409, "Cancel the open shift post before transferring this shift");
    }

    const ins = await query<{ id: string }>(
      `INSERT INTO shift_transfers (shift_id, from_user_id, to_user_id, target_shift_id, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [body.shiftId, fromUserId, body.toUserId, body.targetShiftId ?? null, body.note ?? ""]
    );
    res.status(201).json({ id: ins.rows[0].id });
  } catch (e) {
    next(e);
  }
});

transfersRouter.post("/me/:id/respond", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const body = RespondTransferRequest.parse(req.body);
    const userId = req.auth!.sub;

    const pending = await query<{
      shift_id: string;
      from_user_id: string;
      target_shift_id: string | null;
    }>(
      `SELECT shift_id, from_user_id, target_shift_id FROM shift_transfers
       WHERE id = $1 AND to_user_id = $2 AND status = 'pending'`,
      [req.params.id, userId]
    );
    if (pending.rows.length === 0) throw httpError(404, "Transfer request not found");

    const row = pending.rows[0];

    if (body.status === "accepted") {
      if (row.target_shift_id) {
        const target = await query<{ employee_id: string }>(
          `SELECT employee_id FROM schedule_shifts WHERE id = $1`,
          [row.target_shift_id]
        );
        if (target.rows.length === 0 || target.rows[0].employee_id !== userId) {
          throw httpError(409, "Your shift for this swap is no longer available");
        }
        await query(
          `UPDATE schedule_shifts SET employee_id = $2, updated_at = now() WHERE id = $1`,
          [row.shift_id, userId]
        );
        await query(
          `UPDATE schedule_shifts SET employee_id = $2, updated_at = now() WHERE id = $1`,
          [row.target_shift_id, row.from_user_id]
        );
      } else {
        await query(
          `UPDATE schedule_shifts SET employee_id = $2, updated_at = now() WHERE id = $1`,
          [row.shift_id, userId]
        );
      }

      const workplaceId = req.auth!.workplaceId!;
      await logActivity(
        workplaceId,
        "shift_transfer_accepted",
        "A shift transfer was accepted",
        req.auth!.email
      );
    }

    await query(
      `UPDATE shift_transfers SET status = $2, responded_at = now()
       WHERE id = $1 AND to_user_id = $3 AND status = 'pending'`,
      [req.params.id, body.status, userId]
    );

    const isSwap = Boolean(row.target_shift_id);
    const responder = await query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    const responderName = responder.rows[0]?.name ?? "Your coworker";
    const accepted = body.status === "accepted";

    if (isSwap) {
      await createNotification(
        row.from_user_id,
        req.auth!.workplaceId!,
        accepted ? "shift_request_accepted" : "shift_request_rejected",
        accepted
          ? `${responderName} accepted your shift request`
          : `${responderName} declined your shift request`,
        "/shift-requests",
        req.params.id
      );
    } else {
      await createNotification(
        row.from_user_id,
        req.auth!.workplaceId!,
        accepted ? "transfer_shift_accepted" : "transfer_shift_rejected",
        accepted
          ? `${responderName} accepted your shift transfer`
          : `${responderName} declined your shift transfer`,
        "/transfer-shift",
        req.params.id
      );
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

transfersRouter.get("/coworkers", requireRole("EMPLOYEE"), async (req, res, next) => {
  try {
    const workplaceId = req.auth!.workplaceId!;
    const userId = req.auth!.sub;
    const result = await query(
      `SELECT u.id, u.name, ep.role
       FROM users u
       JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE u.workplace_id = $1 AND u.role = 'EMPLOYEE' AND u.id != $2`,
      [workplaceId, userId]
    );
    res.json(result.rows.map((r) => ({ id: r.id, name: r.name, role: r.role })));
  } catch (e) {
    next(e);
  }
});
