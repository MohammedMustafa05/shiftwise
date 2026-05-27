import { Router } from "express";
import multer from "multer";
import {
  CreateWorkplaceRequest,
  UpdateWorkplacePreferencesRequest,
} from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { importSalesCsv } from "../services/csvImportService.js";
import { getClearviewMode } from "../services/salesSyncService.js";

const upload = multer({ storage: multer.memoryStorage() });

export const workplaceRouter = Router();

workplaceRouter.use(authMiddleware);

workplaceRouter.post("/", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    const body = CreateWorkplaceRequest.parse(req.body);
    const wp = await query(
      `INSERT INTO workplaces (name, slug, timezone, clearview_store_code, preferences)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        body.name,
        body.slug,
        body.timezone ?? "America/Toronto",
        body.clearviewStoreCode ?? "STORE-001",
        JSON.stringify(body.preferences ?? { labourCostPct: 0.2, constraints: {} }),
      ]
    );
    res.status(201).json(wp.rows[0]);
  } catch (e) {
    next(e);
  }
});

workplaceRouter.put(
  "/:id/preferences",
  requireRole("EMPLOYER"),
  async (req, res, next) => {
    try {
      if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
      const body = UpdateWorkplacePreferencesRequest.parse(req.body);
      await query(
        `UPDATE workplaces SET preferences = $2, clearview_store_code = COALESCE($3, clearview_store_code), updated_at = now()
         WHERE id = $1`,
        [
          req.params.id,
          JSON.stringify(body.preferences),
          body.clearviewStoreCode ?? null,
        ]
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

workplaceRouter.post(
  "/:id/sales-data",
  requireRole("EMPLOYER"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
      if (!req.file) throw httpError(400, "CSV file required (field: file)");
      const result = await importSalesCsv(req.params.id, req.file.buffer);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

workplaceRouter.get("/:id/clearview/status", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const conn = await query<{
      store_id: string;
      last_sales_sync_at: Date | null;
      last_sync_error: string | null;
    }>(`SELECT store_id, last_sales_sync_at, last_sync_error FROM clearview_connections WHERE workplace_id = $1`, [
      req.params.id,
    ]);
    if (conn.rows.length === 0) {
      res.json({
        connected: false,
        mode: getClearviewMode(),
        storeId: null,
        lastSalesSyncAt: null,
        lastSyncError: null,
      });
      return;
    }
    const c = conn.rows[0];
    res.json({
      connected: true,
      mode: getClearviewMode(),
      storeId: c.store_id,
      lastSalesSyncAt: c.last_sales_sync_at?.toISOString() ?? null,
      lastSyncError: c.last_sync_error,
    });
  } catch (e) {
    next(e);
  }
});

workplaceRouter.get("/:id/employees", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const result = await query(
      `SELECT ep.id, ep.user_id, ep.role, ep.employee_number, ep.payroll_department, ep.job_code,
              u.name, u.email
       FROM employee_profiles ep
       JOIN users u ON u.id = ep.user_id
       WHERE ep.workplace_id = $1`,
      [req.params.id]
    );
    res.json(
      result.rows.map((e) => ({
        id: e.id,
        userId: e.user_id,
        name: e.name,
        email: e.email,
        role: e.role,
        employeeNumber: e.employee_number,
        payrollDepartment: e.payroll_department,
        jobCode: e.job_code,
      }))
    );
  } catch (e) {
    next(e);
  }
});
