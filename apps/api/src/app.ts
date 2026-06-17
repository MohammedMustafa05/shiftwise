import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { clearviewRouter } from "./routes/clearview.js";
import { workplaceRouter } from "./routes/workplace.js";
import { employeesRouter } from "./routes/employees.js";
import { schedulesRouter } from "./routes/schedules.js";
import { adminRouter } from "./routes/admin.js";
import { approvalsRouter } from "./routes/approvals.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { transfersRouter } from "./routes/transfers.js";
import { openShiftsRouter } from "./routes/openShifts.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRateLimiter, generalRateLimiter } from "./middleware/rateLimit.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(generalRateLimiter);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "shiftagent-api" });
  });

  app.get("/api", (_req, res) => {
    res.json({
      name: "ShiftAgent API",
      version: "0.1.0",
      clearviewMode: process.env.CLEARVIEW_MODE ?? "mock",
    });
  });

  app.use("/api/auth", authRateLimiter, authRouter);
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
  app.use("/api/approvals", approvalsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/transfers", transfersRouter);
  app.use("/api/open-shifts", openShiftsRouter);

  app.use(errorHandler);
  return app;
}
