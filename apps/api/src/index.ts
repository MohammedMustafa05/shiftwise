import { config, assertDatabaseConfigured, assertProductionConfig } from "./config.js";
import { createApp } from "./app.js";
import { startSalesSyncCron } from "./jobs/syncClearviewSales.js";
import { startScheduleWorker } from "./workers/scheduleWorker.js";

assertDatabaseConfigured();
assertProductionConfig();

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  startSalesSyncCron();
  startScheduleWorker();
}

app.listen(config.port, () => {
  console.log(`ShiftAgent API running on http://localhost:${config.port}`);
  console.log(`Clearview mode: ${config.clearview.mode}`);
});

export { app };
