import { Queue, Worker, type Job } from "bullmq";
import { config } from "../config.js";
import { generateSchedule } from "../services/scheduleService.js";

const QUEUE_NAME = "schedule-generation";

export type ScheduleJobData = {
  workplaceId: string;
  weekStart: string;
};

let queue: Queue<ScheduleJobData> | null = null;

function getConnection() {
  if (!config.redisUrl) return null;
  return { url: config.redisUrl };
}

export function getScheduleQueue(): Queue<ScheduleJobData> | null {
  const connection = getConnection();
  if (!connection) return null;
  if (!queue) {
    queue = new Queue<ScheduleJobData>(QUEUE_NAME, { connection });
  }
  return queue;
}

export async function enqueueScheduleGeneration(
  workplaceId: string,
  weekStart: string
): Promise<{ jobId: string } | null> {
  const q = getScheduleQueue();
  if (!q) return null;
  const job = await q.add("generate", { workplaceId, weekStart }, {
    removeOnComplete: 100,
    removeOnFail: 50,
  });
  return { jobId: job.id! };
}

export function startScheduleWorker(): Worker<ScheduleJobData> | null {
  const connection = getConnection();
  if (!connection) return null;

  const worker = new Worker<ScheduleJobData>(
    QUEUE_NAME,
    async (job: Job<ScheduleJobData>) => {
      const { workplaceId, weekStart } = job.data;
      return generateSchedule(workplaceId, weekStart);
    },
    { connection, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[scheduleWorker] job ${job?.id} failed:`, err);
  });

  console.log("[scheduleWorker] BullMQ worker started");
  return worker;
}

export function isAsyncScheduleEnabled(): boolean {
  return Boolean(config.redisUrl) && process.env.LLM_SYNC_MODE !== "true";
}
