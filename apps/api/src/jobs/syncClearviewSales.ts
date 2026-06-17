import cron from "node-cron";
import { syncAllConnectedWorkplaces } from "../services/salesSyncService.js";
import { acquireLock, releaseLock } from "../lib/distributedLock.js";

const LOCK_KEY = "cron:clearview-sales-sync";
const LOCK_TTL = 3600;

/** Monday 02:00 — sync previous week sales for all connected workplaces. */
export function startSalesSyncCron(): void {
  cron.schedule("0 2 * * 1", async () => {
    const acquired = await acquireLock(LOCK_KEY, LOCK_TTL);
    if (!acquired) {
      console.log("[cron] Clearview sales sync skipped — another instance holds the lock");
      return;
    }
    try {
      const results = await syncAllConnectedWorkplaces();
      console.log(`[cron] Clearview sales sync complete: ${results.length} workplace(s)`);
    } catch (err) {
      console.error("[cron] Clearview sales sync failed:", err);
    } finally {
      await releaseLock(LOCK_KEY);
    }
  });
}
