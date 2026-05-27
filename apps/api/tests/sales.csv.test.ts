import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "../src/app.js";
import { signupEmployer } from "./helpers.js";

const app = createApp();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("sales csv upload", () => {
  it("imports csv rows", async () => {
    const { token, workplaceId } = await signupEmployer(app, "-csv1");
    const csvPath = path.resolve(__dirname, "../fixtures/sample_hourly_sales.csv");
    const buffer = fs.readFileSync(csvPath);

    const res = await request(app)
      .post(`/api/workplace/${workplaceId}/sales-data`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", buffer, "sample_hourly_sales.csv");

    expect(res.status).toBe(200);
    expect(res.body.rowsAccepted).toBeGreaterThan(0);
  });
});
