import { Router } from "express";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { getActivity } from "../services/activityService.js";
import { getWeekStart, formatDate } from "../utils/dates.js";

export const dashboardRouter = Router();

dashboardRouter.use(authMiddleware);
dashboardRouter.use(requireRole("EMPLOYER"));

dashboardRouter.get("/summary", async (req, res, next) => {
  try {
    const workplaceId = req.auth!.workplaceId!;
    const weekParam = String(req.query.weekStart ?? "");
    const weekStart = weekParam || formatDate(getWeekStart(new Date()));

    const pending = await query<{ count: string }>(
      `SELECT (
        (SELECT COUNT(*)::int FROM availability_submissions WHERE workplace_id = $1 AND status = 'pending') +
        (SELECT COUNT(*)::int FROM time_off_requests WHERE workplace_id = $1 AND status = 'pending')
      )::text AS count`,
      [workplaceId]
    );

    const shifts = await query<{ start_time: string; end_time: string }>(
      `SELECT ss.start_time::text, ss.end_time::text
       FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       WHERE s.workplace_id = $1 AND s.week_start = $2`,
      [workplaceId, weekStart]
    );

    let scheduledHours = 0;
    for (const s of shifts.rows) {
      const [sh, sm] = s.start_time.split(":").map(Number);
      const [eh, em] = s.end_time.split(":").map(Number);
      scheduledHours += eh + em / 60 - (sh + sm / 60);
    }

    const wp = await query<{ preferences: { labourCostPct?: number; avgHourlyWage?: number } }>(
      `SELECT preferences FROM workplaces WHERE id = $1`,
      [workplaceId]
    );
    const prefs = wp.rows[0]?.preferences ?? {};
    const wage = prefs.avgHourlyWage ?? 18.5;
    const laborCost = scheduledHours * wage;
    const laborBudget = laborCost / Math.max(prefs.labourCostPct ?? 0.2, 0.01);

    res.json({
      pendingApprovals: parseInt(pending.rows[0]?.count ?? "0", 10),
      scheduledHours: Math.round(scheduledHours),
      laborCost: Math.round(laborCost),
      laborBudget: Math.round(laborBudget),
      laborCostPct: Math.round(((laborCost / laborBudget) * 100) * 10) / 10,
      weekStart,
    });
  } catch (e) {
    next(e);
  }
});

dashboardRouter.get("/activity", async (req, res, next) => {
  try {
    const workplaceId = req.auth!.workplaceId!;
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    const items = await getActivity(workplaceId, limit);
    res.json(items);
  } catch (e) {
    next(e);
  }
});
