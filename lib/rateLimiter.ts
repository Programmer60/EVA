import { getRedisClient } from "./redis";
import { logger } from "./logger";
import { AppError } from "./errors";

/**
 * Checks if the user has exceeded the rate limit using a simple fixed-window token bucket approach in Redis.
 * Throws an AppError with 429 status if the limit is exceeded.
 * 
 * @param identifier Unique identifier for the user or IP (e.g., `rate_limit:chat:user123`)
 * @param maxRequests Maximum number of requests allowed in the window
 * @param windowMs Time window in milliseconds
 */
export async function checkRateLimit(identifier: string, maxRequests: number, windowMs: number): Promise<void> {
  const client = getRedisClient();
  
  // If Redis is not configured, bypass rate limiting
  if (!client) return;

  try {
    const windowSeconds = Math.ceil(windowMs / 1000);
    const key = `ratelimit:${identifier}`;
    
    // Increment the counter
    const currentRequests = await client.incr(key);
    
    // If it's the first request in the window, set the expiration
    if (currentRequests === 1) {
      await client.expire(key, windowSeconds);
    }
    
    if (currentRequests > maxRequests) {
      logger.warn(`Rate limit exceeded for ${identifier}`);
      throw new AppError("Too many requests. Please slow down and try again later.", 429);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    logger.error("Rate limiter Redis error", { error: e });
  }
}
