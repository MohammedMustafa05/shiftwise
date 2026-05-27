import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("cron sync-sales", () => {
  it("rejects without cron secret", async () => {
    const res = await request(app).post("/api/admin/sync-sales");
    expect(res.status).toBe(401);
  });
});
