import { beforeAll } from "vitest";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { DataType, newDb } from "pg-mem";
import { setPool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

process.env.CLEARVIEW_MODE = "mock";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret";
process.env.CRON_SECRET = process.env.CRON_SECRET ?? "dev-cron-secret";
process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ??
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NODE_ENV = "test";

function runMigrationsOnMemDb(): void {
  const db = newDb();

  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  const migrationsDir = path.resolve(__dirname, "../../../supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    let sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS[^;]+;/gi, "");
    db.public.none(sql);
  }

  const { Pool } = db.adapters.createPg();
  setPool(new Pool());
}

beforeAll(() => {
  if (process.env.USE_REAL_POSTGRES === "1" && process.env.DATABASE_URL) {
    const { execSync } = require("child_process");
    execSync("npm run db:migrate", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      env: process.env,
    });
    return;
  }
  runMigrationsOnMemDb();
});
