import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signupEmployer, joinEmployee } from "./helpers.js";
import { query } from "../src/db/pool.js";

const app = createApp();

describe("auth", () => {
  it("employer signup returns EMPLOYER JWT", async () => {
    const { res, token } = await signupEmployer(app, "-auth1");
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("EMPLOYER");
    expect(token).toBeTruthy();
  });

  it("employer login works", async () => {
    const { email } = await signupEmployer(app, "-auth2");
    const res = await request(app).post("/api/auth/login").send({
      email,
      password: "password123",
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("employee join via invite slug", async () => {
    const { workplaceId } = await signupEmployer(app, "-auth3");
    const invite = await query<{ slug: string }>(
      `SELECT slug FROM workplace_invites WHERE workplace_id = $1 LIMIT 1`,
      [workplaceId]
    );
    const slug = invite.rows[0].slug;
    const { res } = await joinEmployee(app, slug, "-auth3");
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("EMPLOYEE");
  });
});
