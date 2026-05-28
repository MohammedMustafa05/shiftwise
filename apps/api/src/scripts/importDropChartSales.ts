import fs from "fs";
import { assertDatabaseConfigured } from "../config.js";
import { query, endPool } from "../db/pool.js";
import { defaultDropChartCsvPath, importSalesCsv } from "../services/csvImportService.js";

/**
 * Import apps/ml-engine/drop_chart_all_days.csv into hourly_sales_data.
 * Usage: npm run db:import-sales -w @shiftwise/api
 *        npm run db:import-sales -w @shiftwise/api -- <workplace-id>
 */
async function main() {
  assertDatabaseConfigured();

  const csvPath = process.env.SALES_CSV_PATH ?? defaultDropChartCsvPath();
  if (!fs.existsSync(csvPath)) {
    console.error("CSV not found:", csvPath);
    process.exit(1);
  }

  let workplaceId = process.argv[2];
  if (!workplaceId) {
    const wp = await query<{ id: string; slug: string }>(
      `SELECT id, slug FROM workplaces ORDER BY created_at LIMIT 1`
    );
    if (wp.rows.length === 0) {
      console.error("No workplace found. Run db:seed first or pass workplace id.");
      process.exit(1);
    }
    workplaceId = wp.rows[0].id;
    console.log(`Using workplace: ${wp.rows[0].slug} (${workplaceId})`);
  }

  const buffer = fs.readFileSync(csvPath);
  const result = await importSalesCsv(workplaceId, buffer);
  console.log("Import complete:", {
    file: csvPath,
    format: result.format,
    rowsAccepted: result.rowsAccepted,
    rowsRejected: result.rowsRejected,
    dateRange: result.dateRange,
  });

  await endPool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
