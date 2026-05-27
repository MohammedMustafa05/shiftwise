import { Router } from "express";
import fs from "fs";
import { GenerateScheduleRequest, UpdateShiftRequest } from "@shiftwise/shared";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import {
  generateSchedule,
  getScheduleDetail,
  publishSchedule,
  updateShift,
} from "../services/scheduleService.js";
import { buildClearviewCsv } from "../exports/clearview.js";
import { config } from "../config.js";

export const schedulesRouter = Router();

schedulesRouter.use(authMiddleware);

schedulesRouter.post("/generate", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const body = GenerateScheduleRequest.parse(req.body);
    const result = await generateSchedule(req.auth.workplaceId, body.weekStart);
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
