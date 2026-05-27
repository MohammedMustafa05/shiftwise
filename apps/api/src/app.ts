import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { clearviewRouter } from "./routes/clearview.js";
import { workplaceRouter } from "./routes/workplace.js";
import { employeesRouter } from "./routes/employees.js";
import { schedulesRouter } from "./routes/schedules.js";
import { adminRouter } from "./routes/admin.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "shiftwise-api" });
  });

  app.get("/api", (_req, res) => {
    res.json({
      name: "ShiftWise API",
      version: "0.1.0",
      clearviewMode: process.env.CLEARVIEW_MODE ?? "mock",
    });
  });

  app.use("/api/auth", authRouter);
  // Plan 1 alias: POST /api/join/:slug
  app.post("/api/join/:slug", (req, res, next) => {
    const prevUrl = req.url;
    req.url = `/join/${req.params.slug}`;
    authRouter(req, res, (err) => {
      req.url = prevUrl;
      next(err);
    });
  });
  app.use("/api/clearview", clearviewRouter);
  app.use("/api/workplace", workplaceRouter);
  app.use("/api/employees", employeesRouter);
  app.use("/api/schedules", schedulesRouter);
  app.use("/api/admin", adminRouter);

  app.use(errorHandler);
  return app;
}
