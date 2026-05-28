import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer, joinEmployee } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { formatDate, getWeekStart } from "../src/utils/dates.js";
import { mapSalesToTargetWeek } from "../src/services/enginePayload.js";

const app = createApp();

describe("scheduling engine payload", () => {
  it("maps sales to target week by day-of-week", () => {
    const ref = [
      { date: "2026-05-18", hour: 12, salesAmount: 100 },
      { date: "2026-05-19", hour: 12, salesAmount: 200 },
    ];
    const mapped = mapSalesToTargetWeek(ref, "2026-05-25");
    const mon = mapped.find((r) => r.date === "2026-05-25" && r.hour === 12);
    const tue = mapped.find((r) => r.date === "2026-05-26" && r.hour === 12);
    expect(mon?.sales_amount).toBe(100);
    expect(tue?.sales_amount).toBe(200);
  });
});

describe("schedule generate with engine", () => {
  it("returns workersNeeded.byHour when sales exist", async () => {
    const { token, workplaceId } = await signupEmployer(app, "-eng1");
    const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
    await request(app).get("/api/clearview/callback").query({ code: "mock_auth_code", state, format: "json" });
    await request(app).post("/api/admin/sync-sales").set("x-cron-secret", process.env.CRON_SECRET!);

    const invite = await query<{ slug: string }>(
      `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
      [workplaceId]
    );
    const emp = await joinEmployee(app, invite.rows[0].slug, "-eng1e");
    await request(app)
      .put(`/api/employees/${emp.userId}/availability`)
      .set("Authorization", `Bearer ${emp.token}`)
      .send({ blocks: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }] });

    await query(
      `INSERT INTO availability_submissions (user_id, workplace_id, week_start, availability_grid, status)
       VALUES ($1, $2, $3, '{}', 'approved')
       ON CONFLICT (user_id, week_start) DO UPDATE SET status = 'approved'`,
      [emp.userId, workplaceId, formatDate(getWeekStart(new Date()))]
    );

    const weekStart = formatDate(getWeekStart(new Date()));
    const res = await request(app)
      .post("/api/schedules/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ weekStart });

    expect(res.status).toBe(201);
    expect(res.body.workersNeeded.byHour.length).toBeGreaterThan(0);
    expect(res.body.shifts.length).toBeGreaterThanOrEqual(0);
  });
});
