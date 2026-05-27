import IORedis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

// Create a single shared instance of the Redis client
let redisClient: IORedis | null = null;

export function getRedisClient(): IORedis | null {
  if (redisClient) return redisClient;

  if (env.redisUrl) {
    try {
      const url = new URL(env.redisUrl);
      const isTls = url.protocol === "rediss:";
      redisClient = new IORedis({
        host: url.hostname,
        port: parseInt(url.port || "6379", 10),
        username: url.username || undefined,
        password: url.password || undefined,
        db: url.pathname ? parseInt(url.pathname.replace("/", ""), 10) : 0,
        tls: isTls ? {} : undefined,
      });
      redisClient.on("error", (err) => logger.error("Redis error", { err }));
      logger.info("Connected to Redis successfully");
    } catch (e) {
      logger.error("Failed to initialize Redis client", { error: e });
      redisClient = null;
    }
  }

  return redisClient;
}

/**
 * Helper to cache a value with a time-to-live (TTL) in seconds.
 */
export async function cacheSet(key: string, value: any, ttlSeconds: number = 600): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    const stringValue = typeof value === "string" ? value : JSON.stringify(value);
    await client.set(key, stringValue, "EX", ttlSeconds);
  } catch (e) {
    logger.warn("Redis cacheSet failed", { key, error: e });
  }
}

/**
 * Helper to retrieve a cached value.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const raw = await client.get(key);
    if (!raw) return null;
    
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  } catch (e) {
    logger.warn("Redis cacheGet failed", { key, error: e });
    return null;
  }
}

/**
 * Helper to delete a cached value.
 */
export async function cacheDelete(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    await client.del(key);
  } catch (e) {
    logger.warn("Redis cacheDelete failed", { key, error: e });
  }
}
