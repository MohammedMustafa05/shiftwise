import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer, joinEmployee } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { formatDate, getWeekStart, addDays } from "../src/utils/dates.js";

const app = createApp();

async function setupWorkplaceWithData(suffix: string) {
  const { token, workplaceId } = await signupEmployer(app, suffix);
  const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
  await request(app).get("/api/clearview/callback").query({ code: "mock_auth_code", state, format: "json" });
  await request(app)
    .post("/api/admin/sync-sales")
    .set("x-cron-secret", process.env.CRON_SECRET!);

  const invite = await query<{ slug: string }>(
    `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
    [workplaceId]
  );
  const { userId } = await joinEmployee(app, invite.rows[0].slug, suffix);
  await request(app)
    .put(`/api/employees/${userId}/availability`)
    .set("Authorization", `Bearer ${(await joinEmployee(app, invite.rows[0].slug, suffix + "b")).token}`)
    .send({
      blocks: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    });

  return { token, workplaceId, userId };
}

describe("schedule generate", () => {
  it("creates draft schedule with ml_metadata and shifts", async () => {
    const { token, workplaceId } = await signupEmployer(app, "-gen1");
    const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
    await request(app).get("/api/clearview/callback").query({ code: "mock_auth_code", state, format: "json" });
    await request(app).post("/api/admin/sync-sales").set("x-cron-secret", process.env.CRON_SECRET!);

    const invite = await query<{ slug: string }>(
      `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
      [workplaceId]
    );
    const emp = await joinEmployee(app, invite.rows[0].slug, "-gen1e");
    await request(app)
      .put(`/api/employees/${emp.userId}/availability`)
      .set("Authorization", `Bearer ${emp.token}`)
      .send({ blocks: [{ dayOfWeek: 0, startTime: "09:00", endTime: "17:00" }] });

    const weekStart = formatDate(getWeekStart(addDays(new Date(), 7)));
    const res = await request(app)
      .post("/api/schedules/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ weekStart });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.workersNeeded.byHour.length).toBeGreaterThan(0);
    expect(res.body.shifts.length).toBeGreaterThan(0);
    expect(res.body.scheduleId).toBeTruthy();
  });
});
