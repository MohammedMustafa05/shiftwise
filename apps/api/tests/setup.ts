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
process.env.RATE_LIMIT_DISABLED = "1";

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
    // Strip single-line comments FIRST so semicolons inside comments don't split incorrectly.
    sql = sql.replace(/--[^\n]*/g, "");
    // Strip block comments.
    sql = sql.replace(/\/\*[\s\S]*?\*\//g, "");
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS[^;]+;/gi, "");
    sql = sql.replace(/ALTER PUBLICATION[^;]+;/gi, "");
    // pg-mem cannot parse plpgsql DO $$ ... $$ blocks. These are only used for
    // conditional RLS / realtime setup the in-memory tests don't need, so drop them.
    sql = sql.replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/gi, "");
    // pg-mem does not support RLS — strip these so in-memory tests still run.
    sql = sql.replace(/ALTER TABLE\s+\S+\s+ENABLE ROW LEVEL SECURITY[^;]*;/gi, "");
    sql = sql.replace(/ALTER TABLE\s+\S+\s+DISABLE ROW LEVEL SECURITY[^;]*;/gi, "");
    sql = sql.replace(/DROP POLICY IF EXISTS[^;]+;/gi, "");
    sql = sql.replace(/CREATE POLICY[\s\S]*?;/gi, "");
    sql = sql.replace(/GRANT\s+BYPASSRLS[^;]+;/gi, "");
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      db.public.none(stmt + ";");
    }
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
