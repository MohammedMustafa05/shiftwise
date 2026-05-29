import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer, joinEmployee, submitEmployeeAvailability } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { formatDate, getWeekStart } from "../src/utils/dates.js";
import { CLEARVIEW_EXPORT_COLUMNS } from "@shiftagent/shared";

const app = createApp();

async function generateDraftSchedule(suffix: string) {
  const { token, workplaceId } = await signupEmployer(app, suffix);
  const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
  await request(app).get("/api/clearview/callback").query({ code: "mock_auth_code", state, format: "json" });
  await request(app).post("/api/admin/sync-sales").set("x-cron-secret", process.env.CRON_SECRET!);

  const invite = await query<{ slug: string }>(
    `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
    [workplaceId]
  );
  const emp = await joinEmployee(app, invite.rows[0].slug, `${suffix}e`);
  await submitEmployeeAvailability(app, emp.token);

  const weekStart = formatDate(getWeekStart(new Date()));
  const gen = await request(app)
    .post("/api/schedules/generate")
    .set("Authorization", `Bearer ${token}`)
    .send({ weekStart });

  return { token, workplaceId, scheduleId: gen.body.scheduleId as string, profileId: await getProfileId(emp.userId) };
}

async function getProfileId(userId: string) {
  const r = await query<{ id: string }>(`SELECT id FROM employee_profiles WHERE user_id = $1`, [userId]);
  return r.rows[0].id;
}

describe("schedule publish", () => {
  it("blocks publish when employee_number missing", async () => {
    const { token, scheduleId } = await generateDraftSchedule("-pub1");
    const res = await request(app)
      .post(`/api/schedules/${scheduleId}/publish`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("publish sets published and returns csv export", async () => {
    const { token, scheduleId, profileId } = await generateDraftSchedule("-pub2");
    await request(app)
      .put(`/api/employees/${profileId}/profile`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        employeeNumber: "E100",
        payrollDepartment: "DEPT01",
        jobCode: "COOK",
      });

    const pub = await request(app)
      .post(`/api/schedules/${scheduleId}/publish`)
      .set("Authorization", `Bearer ${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.schedule.status).toBe("published");
    expect(pub.body.downloadUrl).toContain("export/clearview");

    const csv = await request(app)
      .get(`/api/schedules/${scheduleId}/export/clearview`)
      .set("Authorization", `Bearer ${token}`);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\n")[0]).toBe(CLEARVIEW_EXPORT_COLUMNS.join(","));
    expect(csv.text).toContain("E100");
    expect(csv.text).toContain("STORE-001");
  });
});
