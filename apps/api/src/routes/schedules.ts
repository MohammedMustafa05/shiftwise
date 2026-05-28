import { Router } from "express";
import fs from "fs";
import { CreateShiftRequest, GenerateScheduleRequest, UpdateShiftRequest } from "@shiftwise/shared";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import {
  createShift,
  deleteShift,
  generateSchedule,
  getScheduleByWeek,
  getScheduleDetail,
  publishSchedule,
  updateShift,
} from "../services/scheduleService.js";
import { logActivity } from "../services/activityService.js";
import { buildClearviewCsv } from "../exports/clearview.js";
import { config } from "../config.js";

export const schedulesRouter = Router();

schedulesRouter.use(authMiddleware);

schedulesRouter.get("/week/:weekStart", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const detail = await getScheduleByWeek(req.auth.workplaceId, String(req.params.weekStart));
    if (!detail) {
      res.status(404).json({ error: "No schedule for this week" });
      return;
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

schedulesRouter.post("/generate", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const body = GenerateScheduleRequest.parse(req.body);
    const result = await generateSchedule(req.auth.workplaceId, body.weekStart);
    await logActivity(
      req.auth.workplaceId,
      "schedule_generated",
      `Schedule generated for week of ${body.weekStart}`,
      req.auth.email
    );
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

schedulesRouter.get("/:id", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const scheduleId = String(req.params.id);
    const detail = await getScheduleDetail(scheduleId, req.auth.workplaceId);
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

schedulesRouter.post("/:id/shifts", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const body = CreateShiftRequest.parse(req.body);
    const scheduleId = String(req.params.id);
    const created = await createShift(scheduleId, req.auth.workplaceId, body);
    const detail = await getScheduleDetail(scheduleId, req.auth.workplaceId);
    res.status(201).json({ shiftId: created.id, schedule: detail });
  } catch (e) {
    next(e);
  }
});

schedulesRouter.delete("/:id/shifts/:shiftId", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    await deleteShift(String(req.params.id), String(req.params.shiftId), req.auth.workplaceId);
    const detail = await getScheduleDetail(String(req.params.id), req.auth.workplaceId);
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

schedulesRouter.put("/:id/shifts/:shiftId", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const body = UpdateShiftRequest.parse(req.body);
    const scheduleId = String(req.params.id);
    const shiftId = String(req.params.shiftId);
    await updateShift(scheduleId, shiftId, req.auth.workplaceId, body);
    const detail = await getScheduleDetail(scheduleId, req.auth.workplaceId);
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

schedulesRouter.post("/:id/publish", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const result = await publishSchedule(String(req.params.id), req.auth.workplaceId);
    await logActivity(
      req.auth.workplaceId,
      "schedule_published",
      `Published schedule for week of ${result.schedule.weekStart}`,
      req.auth.email
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

schedulesRouter.get("/:id/export/clearview", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const scheduleId = String(req.params.id);
    const sched = await getScheduleDetail(scheduleId, req.auth.workplaceId);
    if (sched.status !== "published") {
      throw httpError(400, "Schedule must be published to export");
    }
    const csv = await buildClearviewCsv(scheduleId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="clearview-schedule-${scheduleId}.csv"`
    );
    res.send(csv);
  } catch (e) {
    next(e);
  }
});
