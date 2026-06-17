import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { config } from "../config.js";
import { getRedis } from "../lib/redis.js";

const noop = (_req: unknown, _res: unknown, next: () => void) => next();

function createLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
}) {
  if (config.rateLimitDisabled) return noop;

  const base = {
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: options.message },
  };

  const redis = getRedis();
  if (redis && config.redisUrl) {
    return rateLimit({
      ...base,
      store: new RedisStore({
        sendCommand: ((command: string, ...args: (string | number | Buffer)[]) =>
          redis.call(command, ...args)) as never,
      }),
    });
  }

  return rateLimit(base);
}

/** Auth endpoints: 10 requests per 15 minutes per IP. */
export const authRateLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many authentication attempts. Try again later.",
});

/** General API: 300 requests per 15 minutes per IP. */
export const generalRateLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: "Too many requests. Try again later.",
});
