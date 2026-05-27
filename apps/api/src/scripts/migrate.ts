import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { config, assertDatabaseConfigured } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  assertDatabaseConfigured();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  const migrationsDir = path.resolve(__dirname, "../../../../supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const applied = await client.query(
      `SELECT 1 FROM schema_migrations WHERE filename = $1`,
      [file]
    );
    if (applied.rows.length > 0) {
      console.log(`Skip ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Apply ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  await client.end();
  console.log("Migrations complete");
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
