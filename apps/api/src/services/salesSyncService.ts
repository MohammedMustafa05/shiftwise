import type { ClearviewSalesSyncResult } from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { getClearviewClient } from "../integrations/clearview/index.js";
import { config } from "../config.js";
import { getPreviousWeekRange } from "../utils/dates.js";

export async function syncWorkplaceSales(workplaceId: string): Promise<ClearviewSalesSyncResult> {
  const wp = await query<{
    clearview_store_code: string | null;
    store_id: string | null;
  }>(
    `SELECT w.clearview_store_code, c.store_id
     FROM workplaces w
     LEFT JOIN clearview_connections c ON c.workplace_id = w.id
     WHERE w.id = $1`,
    [workplaceId]
  );
  if (wp.rows.length === 0) {
    throw new Error("Workplace not found");
  }
  const storeId = wp.rows[0].store_id ?? wp.rows[0].clearview_store_code ?? "STORE-001";
  const { weekStart, weekEnd } = getPreviousWeekRange();
  const client = getClearviewClient();

  try {
    const rows = await client.fetchHourlySales(storeId, weekStart, weekEnd);
    let upserted = 0;
    for (const row of rows) {
      await query(
        `INSERT INTO hourly_sales_data (workplace_id, sale_date, hour, sales_amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workplace_id, sale_date, hour)
         DO UPDATE SET sales_amount = EXCLUDED.sales_amount`,
        [workplaceId, row.date, row.hour, row.salesAmount]
      );
      upserted++;
    }
    await query(
      `UPDATE clearview_connections
       SET last_sales_sync_at = now(), last_sync_error = NULL, updated_at = now()
       WHERE workplace_id = $1`,
      [workplaceId]
    );
    return {
      workplaceId,
      weekStart,
      weekEnd,
      rowsUpserted: upserted,
      mode: client.mode,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    await query(
      `UPDATE clearview_connections SET last_sync_error = $2, updated_at = now() WHERE workplace_id = $1`,
      [workplaceId, message]
    );
    throw err;
  }
}

export async function syncAllConnectedWorkplaces(): Promise<ClearviewSalesSyncResult[]> {
  const connections = await query<{ workplace_id: string }>(
    `SELECT workplace_id FROM clearview_connections`
  );
  const results: ClearviewSalesSyncResult[] = [];
  for (const row of connections.rows) {
    results.push(await syncWorkplaceSales(row.workplace_id));
  }
  return results;
}

export function getClearviewMode(): "mock" | "live" {
  return config.clearview.mode;
}
