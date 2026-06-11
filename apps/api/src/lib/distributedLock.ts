import { getRedis } from "./redis.js";

const LOCK_PREFIX = "shiftagent:lock:";

/**
 * Acquire a distributed lock. Returns true if acquired, false if another holder exists.
 * Falls back to true (allow run) when Redis is unavailable.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  try {
    const result = await redis.set(`${LOCK_PREFIX}${key}`, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (err) {
    console.warn("[distributedLock] acquire failed, allowing run:", err);
    return true;
  }
}

export async function releaseLock(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`${LOCK_PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}
