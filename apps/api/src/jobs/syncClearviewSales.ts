import cron from "node-cron";
import { syncAllConnectedWorkplaces } from "../services/salesSyncService.js";

/** Monday 02:00 — sync previous week sales for all connected workplaces. */
export function startSalesSyncCron(): void {
  cron.schedule("0 2 * * 1", async () => {
    try {
      const results = await syncAllConnectedWorkplaces();
      console.log(`[cron] Clearview sales sync complete: ${results.length} workplace(s)`);
    } catch (err) {
      console.error("[cron] Clearview sales sync failed:", err);
    }
  });
}
