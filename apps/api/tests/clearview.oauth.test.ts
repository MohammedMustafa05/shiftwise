import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer } from "./helpers.js";
import { query } from "../src/db/pool.js";

const app = createApp();

describe("clearview oauth mock", () => {
  it("connect returns mock mode and url", async () => {
    const { token } = await signupEmployer(app, "-cv1");
    const res = await request(app)
      .get("/api/clearview/connect")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("mock");
    expect(res.body.connectUrl).toContain("mock_auth_code");
  });

  it("callback stores encrypted connection", async () => {
    const { workplaceId } = await signupEmployer(app, "-cv2");
    const state = Buffer.from(JSON.stringify({ workplaceId })).toString("base64url");
    await query(`UPDATE workplaces SET clearview_store_code = 'STORE-001' WHERE id = $1`, [
      workplaceId,
    ]);
    const res = await request(app)
      .get("/api/clearview/callback")
      .query({ code: "mock_auth_code", state, format: "json" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const conn = await query(`SELECT * FROM clearview_connections WHERE workplace_id = $1`, [
      workplaceId,
    ]);
    expect(conn.rows.length).toBe(1);
    expect(conn.rows[0].access_token_encrypted).toBeTruthy();
  });
});
