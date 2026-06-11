import { Redis } from "ioredis";
import { config } from "../config.js";

let client: Redis | null = null;
let unavailable = false;

export function getRedis(): Redis | null {
  if (unavailable || !config.redisUrl) return null;
  if (!client) {
    try {
      client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      client.on("error", (err: Error) => {
        console.warn("[Redis] connection error:", err.message);
      });
    } catch (err) {
      console.warn("[Redis] failed to create client:", err);
      unavailable = true;
      return null;
    }
  }
  return client;
}

export async function connectRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    if (redis.status !== "ready") await redis.connect();
    return true;
  } catch (err) {
    console.warn("[Redis] connect failed, using in-memory fallback:", err);
    unavailable = true;
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
