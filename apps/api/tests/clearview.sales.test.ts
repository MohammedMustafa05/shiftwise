import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { getPreviousWeekRange } from "../src/utils/dates.js";

const app = createApp();

async function connectClearview(workplaceId: string) {
  const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
  await request(app)
    .get("/api/clearview/callback")
    .query({ code: "mock_auth_code", state, format: "json" });
}

describe("clearview sales sync", () => {
  it("sync upserts 7x24 rows for previous week", async () => {
    const { token, workplaceId } = await signupEmployer(app, "-sales1");
    await connectClearview(workplaceId);

    const res = await request(app)
      .post("/api/admin/sync-sales")
      .set("x-cron-secret", process.env.CRON_SECRET!)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.synced).toBeGreaterThanOrEqual(1);

    const { weekStart, weekEnd } = getPreviousWeekRange();
    const rows = await query(
      `SELECT sale_date, hour, sales_amount
       FROM hourly_sales_data
       WHERE workplace_id = $1 AND sale_date >= $2 AND sale_date <= $3`,
      [workplaceId, weekStart, weekEnd]
    );
    expect(rows.rows.length).toBe(168);
  });

  it("sync is idempotent", async () => {
    const { workplaceId } = await signupEmployer(app, "-sales2");
    await connectClearview(workplaceId);
    const secret = process.env.CRON_SECRET!;
    await request(app).post("/api/admin/sync-sales").set("x-cron-secret", secret);
    const count1 = await query(`SELECT count(*)::int AS c FROM hourly_sales_data WHERE workplace_id = $1`, [
      workplaceId,
    ]);
    await request(app).post("/api/admin/sync-sales").set("x-cron-secret", secret);
    const count2 = await query(`SELECT count(*)::int AS c FROM hourly_sales_data WHERE workplace_id = $1`, [
      workplaceId,
    ]);
    expect(count1.rows[0].c).toBe(count2.rows[0].c);
  });
});
