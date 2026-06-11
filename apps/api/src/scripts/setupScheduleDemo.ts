/**
 * One-shot local setup: migrate → restaurant roster → Clearview sales → align to previous week.
 * Run: npm run db:setup-schedule-demo -w @shiftagent/api
 */
import { execSync } from "child_process";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { config, assertDatabaseConfigured } from "../config.js";
import { addDays, formatDate, getPreviousWeekRange, getWeekStart } from "../utils/dates.js";
import { endPool } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

function run(cmd: string, cwd = REPO_ROOT) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}

async function resolveWorkplaceId(client: pg.Client): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM workplaces WHERE slug = 'demo-restaurant' LIMIT 1`
  );
  if (r.rows.length === 0) {
    throw new Error("demo-restaurant workplace not found — seed-restaurant may have failed");
  }
  return r.rows[0].id;
}

/** Copy hourly sales onto previous Mon–Sun using matching day-of-week from any imported dates. */
async function alignSalesToPreviousWeek(client: pg.Client, workplaceId: string): Promise<void> {
  const { weekStart } = getPreviousWeekRange();
  const prevMonday = new Date(`${weekStart}T12:00:00Z`);

  const sources = await client.query<{ sale_date: string; day_of_week: number }>(
    `SELECT DISTINCT ON (day_of_week)
       sale_date::text AS sale_date,
       day_of_week
     FROM hourly_sales_data
     WHERE workplace_id = $1
       AND data_source IN ('drop_chart', 'cash_sheet')
       AND sale_date <= ($2::date - interval '7 days')::date
     ORDER BY day_of_week, sale_date DESC`,
    [workplaceId, weekStart]
  );

  if (sources.rows.length === 0) {
    console.warn("No Clearview sales to align — synthetic previous-week data from seed is used.");
    return;
  }

  const dowToSource = new Map<number, string>();
  for (const row of sources.rows) {
    dowToSource.set(row.day_of_week, row.sale_date.slice(0, 10));
  }
  const fallbackSource = sources.rows[sources.rows.length - 1]?.sale_date.slice(0, 10);

  for (let d = 0; d < 7; d++) {
    const target = addDays(prevMonday, d);
    const targetDate = formatDate(target);
    const dow = target.getUTCDay();
    const sourceDate = dowToSource.get(dow) ?? fallbackSource;
    if (!sourceDate) continue;

    await client.query(
      `DELETE FROM hourly_sales_data WHERE workplace_id = $1 AND sale_date = $2::date`,
      [workplaceId, targetDate]
    );

    const ins = await client.query(
      `INSERT INTO hourly_sales_data
         (workplace_id, sale_date, hour, sales_amount, day_of_week,
          is_anomaly, anomaly_reason, data_source, transaction_count, source_file)
       SELECT $1, $2::date, hour, sales_amount, $3,
              false, NULL, data_source, transaction_count, source_file
       FROM hourly_sales_data
       WHERE workplace_id = $1 AND sale_date = $4::date`,
      [workplaceId, targetDate, dow, sourceDate]
    );

    console.log(`  ${targetDate} ← ${sourceDate} (${ins.rowCount ?? 0} hours)`);
  }

  const { weekEnd } = getPreviousWeekRange();
  console.log(`Sales aligned to previous week (${weekStart} – ${weekEnd}) for generate.`);
}

async function main() {
  assertDatabaseConfigured();

  run("npm run db:migrate -w @shiftagent/api");
  run("npm run db:seed-restaurant -w @shiftagent/api");

  try {
    run("npm run db:import-clearview-sales -w @shiftagent/api -- --slug demo-restaurant");
  } catch {
    console.warn("\nClearview import skipped or failed — synthetic sales from seed still work.\n");
  }

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const workplaceId = await resolveWorkplaceId(client);
    console.log("\nAligning Clearview sales to previous week for workplace", workplaceId);
    await alignSalesToPreviousWeek(client, workplaceId);
  } finally {
    await client.end();
    await endPool();
  }

  const weekStart = formatDate(getWeekStart(new Date()));
  console.log(`
=== Ready to test Generate Schedule ===

  npm run dev:stack

Login: employer@demo.com / password123
Schedule → week starting ${weekStart} → Generate (wait 2–3 min)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
