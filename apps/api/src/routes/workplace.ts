import { Router } from "express";
import multer from "multer";
import {
  CreateWorkplaceRequest,
  UpdateSalesRequest,
  UpdateWebPreferencesRequest,
  UpdateWorkplacePreferencesRequest,
} from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { importSalesCsv } from "../services/csvImportService.js";
import { getClearviewMode } from "../services/salesSyncService.js";
import { addDays, formatDate, getWeekStart } from "../utils/dates.js";
import { mapWebEmployee, profileDataFromWebInput, apiRoleFromWeb } from "../utils/employeeMap.js";
import bcrypt from "bcryptjs";
import { logActivity } from "../services/activityService.js";

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

workplaceRouter.get("/:id", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const wp = await query(
      `SELECT id, name, slug, timezone, preferences, operating_hours, clearview_store_code FROM workplaces WHERE id = $1`,
      [req.params.id]
    );
    if (wp.rows.length === 0) throw httpError(404, "Workplace not found");
    const row = wp.rows[0];
    const prefs = row.preferences ?? {};
    const constraints = prefs.constraints ?? {};
    res.json({
      id: row.id,
      name: row.name,
      preferences: {
        laborCostTarget: Math.round((prefs.labourCostPct ?? 0.2) * 100),
        maxConsecutiveDays: constraints.maxConsecutiveDays ?? 5,
        minAvailabilityHours: constraints.minAvailabilityHours ?? 20,
        maxHoursPerWeek: constraints.maxHoursPerWeek ?? 45,
        roleRequirements: constraints.roleRequirements ?? {},
        operatingHours: row.operating_hours?.default ?? { open: "10:00", close: "22:00" },
        operatingHoursByDay: row.operating_hours?.byDay ?? {},
      },
    });
  } catch (e) {
    next(e);
  }
});

workplaceRouter.put("/:id/web-preferences", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const body = UpdateWebPreferencesRequest.parse(req.body);
    const preferences = {
      labourCostPct: body.laborCostTarget / 100,
      avgHourlyWage: 18.5,
      constraints: {
        maxConsecutiveDays: body.maxConsecutiveDays,
        minAvailabilityHours: body.minAvailabilityHours,
        maxHoursPerWeek: body.maxHoursPerWeek,
        roleRequirements: body.roleRequirements,
      },
      shiftLengthHours: 8,
      jobCodeMapping: {},
    };
    const operatingHours = {
      default: body.operatingHours,
      byDay: body.operatingHoursByDay ?? {},
    };
    await query(
      `UPDATE workplaces SET preferences = $2, operating_hours = $3, updated_at = now() WHERE id = $1`,
      [req.params.id, JSON.stringify(preferences), JSON.stringify(operatingHours)]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

workplaceRouter.get("/:id/sales", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const weekStart = String(req.query.weekStart ?? formatDate(getWeekStart(new Date())));
    const start = new Date(weekStart + "T12:00:00");
    const days: { date: string; hourlySales: Record<string, number> }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = formatDate(addDays(start, i));
      const rows = await query<{ hour: number; sales_amount: string }>(
        `SELECT hour, sales_amount FROM hourly_sales_data WHERE workplace_id = $1 AND sale_date = $2`,
        [req.params.id, date]
      );
      const hourlySales: Record<string, number> = {};
      for (const r of rows.rows) {
        hourlySales[String(r.hour)] = parseFloat(r.sales_amount);
      }
      days.push({ date, hourlySales });
    }
    res.json({ weekStart, days });
  } catch (e) {
    next(e);
  }
});

workplaceRouter.put("/:id/sales", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const body = UpdateSalesRequest.parse(req.body);
    for (const day of body.days) {
      for (const [hour, amount] of Object.entries(day.hourlySales)) {
        await query(
          `INSERT INTO hourly_sales_data (workplace_id, sale_date, hour, sales_amount)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET sales_amount = EXCLUDED.sales_amount`,
          [req.params.id, day.date, parseInt(hour, 10), amount]
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

workplaceRouter.get("/:id/team-schedule", requireRole("EMPLOYEE", "EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const weekStart = String(req.query.weekStart ?? formatDate(getWeekStart(new Date())));
    const weekDate = new Date(weekStart + "T12:00:00");
    const result = await query(
      `SELECT ss.id, ss.employee_id, ss.shift_date, ss.start_time::text, ss.end_time::text, ss.role, ss.day_of_week,
              u.name AS employee_name
       FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       JOIN users u ON u.id = ss.employee_id
       WHERE s.workplace_id = $1 AND s.week_start = $2 AND s.status = 'published'
       ORDER BY ss.shift_date, ss.start_time`,
      [req.params.id, weekStart]
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        shiftDate: String(r.shift_date).slice(0, 10),
        startTime: r.start_time.slice(0, 5),
        endTime: r.end_time.slice(0, 5),
        role: r.role,
        dayIndex: r.day_of_week === 0 ? 6 : r.day_of_week - 1,
      }))
    );
  } catch (e) {
    next(e);
  }
});

workplaceRouter.post("/:id/employees", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const name = String(req.body.name ?? "");
    const email = String(req.body.email ?? "");
    const body = profileDataFromWebInput({ ...req.body, phone: req.body.phone ?? req.body.phone });
    const password = String(req.body.password ?? "password123");
    if (!name || !email) throw httpError(400, "Name and email required");

    const hash = await bcrypt.hash(password, 10);
    const user = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, workplace_id, name, phone)
       VALUES ($1, $2, 'EMPLOYEE', $3, $4, $5)
       RETURNING id`,
      [email, hash, req.params.id, name, body.phone ?? null]
    );
    const profile = await query<{ id: string; created_at: Date }>(
      `INSERT INTO employee_profiles (user_id, workplace_id, role, profile_data)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [user.rows[0].id, req.params.id, apiRoleFromWeb(body.roles), JSON.stringify(body)]
    );
    await logActivity(req.params.id, "employee_added", `Added new employee ${name}`, req.auth!.email);
    res.status(201).json(
      mapWebEmployee({
        id: profile.rows[0].id,
        user_id: user.rows[0].id,
        role: apiRoleFromWeb(body.roles),
        profile_data: body,
        created_at: profile.rows[0].created_at,
        name,
        email,
        phone: body.phone ?? null,
      })
    );
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") {
      next(httpError(409, "Email already exists"));
      return;
    }
    next(e);
  }
});

workplaceRouter.patch("/:id/employees/:profileId", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const pd = profileDataFromWebInput(req.body);
    const name = req.body.name ? String(req.body.name) : undefined;
    const email = req.body.email ? String(req.body.email) : undefined;

    const profile = await query<{ user_id: string }>(
      `SELECT user_id FROM employee_profiles WHERE id = $1 AND workplace_id = $2`,
      [req.params.profileId, req.params.id]
    );
    if (profile.rows.length === 0) throw httpError(404, "Employee not found");

    await query(
      `UPDATE employee_profiles SET role = COALESCE($2, role), profile_data = profile_data || $3::jsonb, updated_at = now()
       WHERE id = $1`,
      [req.params.profileId, req.body.role ? apiRoleFromWeb(req.body.role) : null, JSON.stringify(pd)]
    );
    if (name || email || pd.phone) {
      await query(
        `UPDATE users SET name = COALESCE($2, name), email = COALESCE($3, email), phone = COALESCE($4, phone), updated_at = now()
         WHERE id = $1`,
        [profile.rows[0].user_id, name ?? null, email ?? null, pd.phone ?? null]
      );
    }

    const full = await query(
      `SELECT ep.id, ep.user_id, ep.role, ep.profile_data, ep.created_at, u.name, u.email, u.phone
       FROM employee_profiles ep JOIN users u ON u.id = ep.user_id WHERE ep.id = $1`,
      [req.params.profileId]
    );
    res.json(mapWebEmployee(full.rows[0] as Parameters<typeof mapWebEmployee>[0]));
  } catch (e) {
    next(e);
  }
});

workplaceRouter.get("/:id/employees", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
    const result = await query(
      `SELECT ep.id, ep.user_id, ep.role, ep.profile_data, ep.created_at,
              u.name, u.email, u.phone
       FROM employee_profiles ep
       JOIN users u ON u.id = ep.user_id
       WHERE ep.workplace_id = $1`,
      [req.params.id]
    );
    res.json(result.rows.map((e) => mapWebEmployee(e as Parameters<typeof mapWebEmployee>[0])));
  } catch (e) {
    next(e);
  }
});
