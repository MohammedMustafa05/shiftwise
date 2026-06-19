import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import {
  CreateWorkplaceRequest,
  UpdateSalesRequest,
  UpdateWebPreferencesRequest,
  UpdateWorkplacePreferencesRequest,
} from "@shiftagent/shared";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { httpError } from "../middleware/errorHandler.js";
import { importSalesCsv } from "../services/csvImportService.js";
import { getClearviewMode } from "../services/salesSyncService.js";
import { addDays, formatDate, getWeekStart, toIsoDate } from "../utils/dates.js";
import {
  mapWebEmployee,
  profileDataFromWebInput,
  apiRoleFromWeb,
  displayNameFromProfile,
} from "../utils/employeeMap.js";
import bcrypt from "bcryptjs";
import { logActivity } from "../services/activityService.js";
import {
  selectionFromBlockInput,
  gridFromSelections,
  selectionsFromGrid,
  totalHoursFromSelections,
  dayNameFromDow,
  type BlockKey,
} from "../utils/availabilityBlocks.js";

/** Generates a URL-safe 24-character random token (144 bits of entropy). */
function generateInviteToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

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
      if (!req.file) throw httpError(400, "File required (field: file)");
      const saleDate = typeof req.query.saleDate === "string" ? req.query.saleDate : undefined;
      const result = await importSalesCsv(req.params.id, req.file.buffer, { saleDate });
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
        minDaysOffPerWeek: constraints.minDaysOffPerWeek ?? 2,
        submitAvailabilityReminderEnabled:
          constraints.submitAvailabilityReminderEnabled !== false,
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
      avgHourlyWage: 20,
      constraints: {
        maxConsecutiveDays: body.maxConsecutiveDays,
        minAvailabilityHours: body.minAvailabilityHours,
        minDaysOffPerWeek: body.minDaysOffPerWeek ?? 2,
        submitAvailabilityReminderEnabled: body.submitAvailabilityReminderEnabled ?? true,
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
              u.name AS employee_name, ep.profile_data
       FROM schedule_shifts ss
       JOIN schedules s ON s.id = ss.schedule_id
       JOIN users u ON u.id = ss.employee_id
       JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE s.workplace_id = $1 AND s.week_start = $2 AND s.status = 'published'
       ORDER BY ss.shift_date, ss.start_time`,
      [req.params.id, weekStart]
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: displayNameFromProfile(r.employee_name, r.profile_data ?? {}),
        shiftDate: toIsoDate(r.shift_date),
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
    const password = String(req.body.password ?? "");
    if (!name || !email) throw httpError(400, "Name and email required");
    if (!password || password.length < 8) {
      throw httpError(400, "Password required (minimum 8 characters)");
    }

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

workplaceRouter.delete("/:id/employees/:profileId", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");

    const profile = await query<{ user_id: string; name: string; role: string }>(
      `SELECT u.id AS user_id, u.name, u.role
       FROM employee_profiles ep
       JOIN users u ON u.id = ep.user_id
       WHERE ep.id = $1 AND ep.workplace_id = $2`,
      [req.params.profileId, req.params.id]
    );
    if (profile.rows.length === 0) throw httpError(404, "Employee not found");
    if (profile.rows[0].role !== "EMPLOYEE") throw httpError(400, "Cannot remove this user");

    const { user_id: userId, name } = profile.rows[0];
    await query(`DELETE FROM users WHERE id = $1 AND workplace_id = $2`, [userId, req.params.id]);
    await logActivity(req.params.id, "employee_removed", `Removed employee ${name}`, req.auth!.email);
    res.json({ ok: true });
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

/**
 * GET /api/workplace/:id/employees/:profileId/availability?weekStart=YYYY-MM-DD
 * Manager-side view of an employee's submitted availability for a week.
 * Returns a day->block map ("morning" | "evening" | "full" | "off").
 */
workplaceRouter.get(
  "/:id/employees/:profileId/availability",
  requireRole("EMPLOYER"),
  async (req, res, next) => {
    try {
      if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
      const weekStart = String(req.query.weekStart ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw httpError(400, "weekStart (YYYY-MM-DD) required");

      const profile = await query<{ user_id: string }>(
        `SELECT user_id FROM employee_profiles WHERE id = $1 AND workplace_id = $2`,
        [req.params.profileId, req.params.id]
      );
      if (profile.rows.length === 0) throw httpError(404, "Employee not found");

      const sub = await query<{ availability_grid: Record<string, unknown>; status: string }>(
        `SELECT availability_grid, status FROM availability_submissions
         WHERE user_id = $1 AND week_start = $2`,
        [profile.rows[0].user_id, weekStart]
      );

      const days: Record<string, BlockKey> = {};
      if (sub.rows[0]?.availability_grid) {
        for (const s of selectionsFromGrid(sub.rows[0].availability_grid)) {
          days[dayNameFromDow(s.dayOfWeek)] = s.block;
        }
      }
      res.json({ weekStart, status: sub.rows[0]?.status ?? null, days });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * PUT /api/workplace/:id/employees/:profileId/availability
 * Manager enters an employee's availability (interim, before the employee app exists).
 * Body: { weekStart: "YYYY-MM-DD", days: { monday: "full" | "morning" | "evening" | "off", ... } }
 * Writes an approved availability_submission for the week so the scheduler can use it.
 */
workplaceRouter.put(
  "/:id/employees/:profileId/availability",
  requireRole("EMPLOYER"),
  async (req, res, next) => {
    try {
      if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");
      const weekStart = String(req.body?.weekStart ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw httpError(400, "weekStart (YYYY-MM-DD) required");
      const days = (req.body?.days ?? {}) as Record<string, string>;

      const profile = await query<{ user_id: string }>(
        `SELECT user_id FROM employee_profiles WHERE id = $1 AND workplace_id = $2`,
        [req.params.profileId, req.params.id]
      );
      if (profile.rows.length === 0) throw httpError(404, "Employee not found");
      const userId = profile.rows[0].user_id;

      const DOW: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
      };
      const validBlocks: BlockKey[] = ["morning", "evening", "full", "off"];
      const selections = [];
      for (const [dayName, block] of Object.entries(days)) {
        const dow = DOW[dayName.toLowerCase()];
        if (dow === undefined) throw httpError(400, `Unknown day: ${dayName}`);
        if (!validBlocks.includes(block as BlockKey)) {
          throw httpError(400, `Invalid block "${block}" — use morning, evening, full, or off`);
        }
        if (block === "off") continue;
        selections.push(selectionFromBlockInput(dow, block as BlockKey));
      }

      const grid = gridFromSelections(selections);
      await query(
        `INSERT INTO availability_submissions (user_id, workplace_id, week_start, availability_grid, status, submitted_at)
         VALUES ($1, $2, $3, $4, 'approved', now())
         ON CONFLICT (user_id, week_start) DO UPDATE SET
           availability_grid = EXCLUDED.availability_grid, status = 'approved', submitted_at = now()`,
        [userId, req.params.id, weekStart, JSON.stringify(grid)]
      );

      // Mirror into the recurring availability table (kept consistent with the employee flow).
      await query(`DELETE FROM employee_availability WHERE user_id = $1`, [userId]);
      for (const s of selections) {
        await query(
          `INSERT INTO employee_availability (user_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)`,
          [userId, s.dayOfWeek, s.startTime, s.endTime]
        );
      }

      res.json({ ok: true, weekStart, totalHours: totalHoursFromSelections(selections) });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * POST /api/workplaces/:id/invite-link
 * Generates a fresh time-limited invite token for employees to join.
 * Returns { inviteUrl, token, expiresAt }.
 * The token is a random 24-character slug; each call creates a new one (old ones still work
 * until they expire so sharing multiple links is safe).
 */
workplaceRouter.post("/:id/invite-link", requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (req.auth?.workplaceId !== req.params.id) throw httpError(403, "Forbidden");

    const ttlDays = typeof req.body?.ttlDays === "number" ? Math.min(req.body.ttlDays, 30) : 7;
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    await query(
      `INSERT INTO workplace_invites (workplace_id, slug, expires_at)
       VALUES ($1, $2, $3)`,
      [req.params.id, token, expiresAt]
    );

    const baseUrl = (req.headers["origin"] as string | undefined)
      ?? process.env.WEB_URL
      ?? "http://localhost:5173";

    res.json({
      token,
      expiresAt,
      inviteUrl: `${baseUrl}/join/${token}`,
    });
  } catch (e) {
    next(e);
  }
});
