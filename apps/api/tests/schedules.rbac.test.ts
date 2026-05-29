import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer, joinEmployee, submitEmployeeAvailability } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { formatDate, getWeekStart, addDays } from "../src/utils/dates.js";

const app = createApp();

describe("rbac", () => {
  it("employee cannot generate schedule", async () => {
    const { workplaceId } = await signupEmployer(app, "-rbac1");
    const invite = await query<{ slug: string }>(
      `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
      [workplaceId]
    );
    const { token } = await joinEmployee(app, invite.rows[0].slug, "-rbac1");
    const res = await request(app)
      .post("/api/schedules/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ weekStart: formatDate(getWeekStart(addDays(new Date(), 7))) });
    expect(res.status).toBe(403);
  });

  it("employee only sees published schedule", async () => {
    const { token: employerToken, workplaceId } = await signupEmployer(app, "-rbac2");
    const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
    await request(app).get("/api/clearview/callback").query({ code: "mock_auth_code", state, format: "json" });
    await request(app).post("/api/admin/sync-sales").set("x-cron-secret", process.env.CRON_SECRET!);

    const invite = await query<{ slug: string }>(
      `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
      [workplaceId]
    );
    const emp = await joinEmployee(app, invite.rows[0].slug, "-rbac2e");
    await submitEmployeeAvailability(app, emp.token);

    const profile = await query<{ id: string }>(`SELECT id FROM employee_profiles WHERE user_id = $1`, [
      emp.userId,
    ]);
    await request(app)
      .put(`/api/employees/${profile.rows[0].id}/profile`)
      .set("Authorization", `Bearer ${employerToken}`)
      .send({ employeeNumber: "E200", payrollDepartment: "D1", jobCode: "STAFF" });

    const weekStart = formatDate(getWeekStart(new Date()));
    const gen = await request(app)
      .post("/api/schedules/generate")
      .set("Authorization", `Bearer ${employerToken}`)
      .send({ weekStart });

    const draftView = await request(app)
      .get(`/api/employees/me/schedule`)
      .set("Authorization", `Bearer ${emp.token}`);
    expect(draftView.body.shifts.length).toBe(0);

    await request(app)
      .post(`/api/schedules/${gen.body.scheduleId}/publish`)
      .set("Authorization", `Bearer ${employerToken}`);

    const published = await request(app)
      .get(`/api/employees/me/schedule`)
      .set("Authorization", `Bearer ${emp.token}`);
    expect(published.body.shifts.length).toBeGreaterThan(0);
    expect(published.body.shifts[0].workplaceName).toBeTruthy();
  });
});
