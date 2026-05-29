import { Router } from "express";
import { CreateOpenShiftRequest } from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { logActivity } from "../services/activityService.js";
import { createNotification } from "../services/notificationService.js";
import { normalizeRole } from "../utils/employeeMap.js";
import { toIsoDate } from "../utils/dates.js";

export const openShiftsRouter = Router();

openShiftsRouter.use(authMiddleware);
openShiftsRouter.use(requireRole("EMPLOYEE"));

function rolesMatch(a: string, b: string): boolean {
  return normalizeRole(a).toUpperCase() === normalizeRole(b).toUpperCase();
}

async function assertOwnPublishedShift(userId: string, shiftId: string) {
  const shift = await query<{ employee_id: string; role: string }>(
    `SELECT ss.employee_id, ss.role FROM schedule_shifts ss
     JOIN schedules s ON s.id = ss.schedule_id
     WHERE ss.id = $1 AND s.status = 'published'`,
    [shiftId]
  );
  if (shift.rows.length === 0) throw httpError(404, "Shift not found");
  if (shift.rows[0].employee_id !== userId) {
    throw httpError(403, "You can only offer your own shifts");
  }
  return shift.rows[0];
}

openShiftsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.auth!.sub;
    const workplaceId = req.auth!.workplaceId!;
    const profile = await query<{ role: string }>(
      `SELECT role FROM employee_profiles WHERE user_id = $1`,
      [userId]
    );
    const myRole = profile.rows[0]?.role ?? "STAFF";

    const result = await query(
      `SELECT osp.id, osp.shift_id, osp.posted_by, osp.note, osp.created_at,
              ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role,
              u.name AS posted_by_name
       FROM open_shift_posts osp
       JOIN schedule_shifts ss ON ss.id = osp.shift_id
       JOIN users u ON u.id = osp.posted_by
       WHERE osp.workplace_id = $1 AND osp.status = 'open' AND osp.posted_by != $2
       ORDER BY osp.created_at DESC`,
      [workplaceId, userId]
    );

    res.json(
      result.rows
        .filter((r) => rolesMatch(String(r.role), myRole))
        .map((r) => ({
          id: r.id,
          shiftId: r.shift_id,
          postedById: r.posted_by,
          postedByName: r.posted_by_name,
          shiftDate: toIsoDate(r.shift_date),
          startTime: r.start_time.slice(0, 5),
          endTime: r.end_time.slice(0, 5),
          role: normalizeRole(r.role),
          note: r.note,
          createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        }))
    );
  } catch (e) {
    next(e);
  }
});

openShiftsRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateOpenShiftRequest.parse(req.body);
    const userId = req.auth!.sub;
    const workplaceId = req.auth!.workplaceId!;

    await assertOwnPublishedShift(userId, body.shiftId);

    const pendingTransfer = await query(
      `SELECT id FROM shift_transfers WHERE shift_id = $1 AND status = 'pending' LIMIT 1`,
      [body.shiftId]
    );
    if (pendingTransfer.rows.length > 0) {
      throw httpError(409, "This shift already has a pending transfer request");
    }

    const existing = await query(
      `SELECT id FROM open_shift_posts WHERE shift_id = $1 AND status = 'open' LIMIT 1`,
      [body.shiftId]
    );
    if (existing.rows.length > 0) {
      throw httpError(409, "This shift is already posted as open");
    }

    const ins = await query<{ id: string }>(
      `INSERT INTO open_shift_posts (shift_id, posted_by, workplace_id, note)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [body.shiftId, userId, workplaceId, body.note ?? ""]
    );

    const user = await query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    await logActivity(
      workplaceId,
      "open_shift_posted",
      `${user.rows[0]?.name ?? "Employee"} posted an open shift`,
      req.auth!.email
    );

    res.status(201).json({ id: ins.rows[0].id });
  } catch (e) {
    next(e);
  }
});

openShiftsRouter.post("/:id/claim", async (req, res, next) => {
  try {
    const userId = req.auth!.sub;
    const workplaceId = req.auth!.workplaceId!;

    const post = await query<{
      id: string;
      shift_id: string;
      posted_by: string;
      status: string;
      role: string;
    }>(
      `SELECT osp.id, osp.shift_id, osp.posted_by, osp.status, ss.role
       FROM open_shift_posts osp
       JOIN schedule_shifts ss ON ss.id = osp.shift_id
       WHERE osp.id = $1 AND osp.workplace_id = $2`,
      [req.params.id, workplaceId]
    );
    if (post.rows.length === 0) throw httpError(404, "Open shift not found");
    const row = post.rows[0];
    if (row.status !== "open") throw httpError(409, "This shift is no longer available");
    if (row.posted_by === userId) throw httpError(400, "You cannot claim your own shift");

    const profile = await query<{ role: string }>(
      `SELECT role FROM employee_profiles WHERE user_id = $1`,
      [userId]
    );
    if (!rolesMatch(row.role, profile.rows[0]?.role ?? "")) {
      throw httpError(403, "This shift is not available for your role");
    }

    const claimed = await query(
      `UPDATE open_shift_posts SET status = 'claimed', claimed_by = $2, claimed_at = now()
       WHERE id = $1 AND status = 'open'`,
      [req.params.id, userId]
    );
    if (claimed.rowCount === 0) throw httpError(409, "This shift was just claimed by someone else");

    await query(
      `UPDATE schedule_shifts SET employee_id = $2, updated_at = now() WHERE id = $1`,
      [row.shift_id, userId]
    );

    const claimer = await query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    await logActivity(
      workplaceId,
      "open_shift_claimed",
      `${claimer.rows[0]?.name ?? "Employee"} claimed an open shift`,
      req.auth!.email
    );

    await createNotification(
      row.posted_by,
      workplaceId,
      "offer_shift_accepted",
      `${claimer.rows[0]?.name ?? "A coworker"} claimed your offered shift`,
      "/offer-shift",
      req.params.id
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
