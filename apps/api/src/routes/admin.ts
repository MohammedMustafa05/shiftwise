import { Router } from "express";
import { config } from "../config.js";
import { httpError } from "../middleware/errorHandler.js";
import { syncAllConnectedWorkplaces } from "../services/salesSyncService.js";

export const adminRouter = Router();

adminRouter.post("/sync-sales", async (req, res, next) => {
  try {
    const secret = req.headers["x-cron-secret"] ?? req.body?.secret;
    if (secret !== config.cronSecret) {
      throw httpError(401, "Invalid cron secret");
    }
    const results = await syncAllConnectedWorkplaces();
    res.json({ synced: results.length, results });
  } catch (e) {
    next(e);
  }
});
