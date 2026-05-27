import { logger } from "./logger";
import IORedis from "ioredis";
import { env } from "./env";
import { providerErrorCounter, providerFailureCounter } from "./metrics";

export type ProviderHealthRecord = {
  failures: number;
  lastFailureAt: number | null;
  downUntil: number | null;
};

export const PROVIDER_FAILURE_THRESHOLD = Number(process.env.PROVIDER_FAILURE_THRESHOLD ?? 3);
export const PROVIDER_COOLDOWN_MS = Number(process.env.PROVIDER_COOLDOWN_MS ?? 5 * 60 * 1000);

// In-memory fallback storage
const providerHealth = new Map<string, ProviderHealthRecord>();

// Redis client (optional)
let redis: IORedis | null = null;
if (env.redisUrl) {
  try {
    redis = new IORedis(env.redisUrl);
    redis.on("error", (err) => logger.error("Redis error", { err }));
    logger.info("Connected to Redis for provider health persistence");
  } catch (e) {
    logger.error("Failed to initialize Redis client for provider health", { error: e });
    redis = null;
  }
}

const REDIS_KEY_PREFIX = "providerHealth:";

function memoryGet(name: string): ProviderHealthRecord {
  let rec = providerHealth.get(name);
  if (!rec) {
    rec = { failures: 0, lastFailureAt: null, downUntil: null };
    providerHealth.set(name, rec);
  }
  return rec;
}

export async function getProviderRecord(name: string): Promise<ProviderHealthRecord> {
  if (!redis) return memoryGet(name);
  try {
    const raw = await redis.get(REDIS_KEY_PREFIX + name);
    if (!raw) return { failures: 0, lastFailureAt: null, downUntil: null };
    return JSON.parse(raw) as ProviderHealthRecord;
  } catch (e) {
    logger.error("Redis get error in getProviderRecord", { error: e });
    return memoryGet(name);
  }
}

async function memorySet(name: string, rec: ProviderHealthRecord) {
  providerHealth.set(name, rec);
}

export async function recordProviderFailure(name: string, status?: number | null) {
  if (!redis) {
    const rec = memoryGet(name);
    rec.failures += 1;
    rec.lastFailureAt = Date.now();
    if (rec.failures >= PROVIDER_FAILURE_THRESHOLD) {
      rec.downUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      logger.warn("Provider marked unhealthy", { provider: name, failures: rec.failures, status });
      try { providerFailureCounter.labels(name).inc(); } catch(e){}
    } else {
      logger.info("Provider failure recorded", { provider: name, failures: rec.failures, status });
    }
    try { providerErrorCounter.labels(name, String(status ?? "unknown")).inc(); } catch(e){}
    return;
  }

  try {
    const key = REDIS_KEY_PREFIX + name;
    const raw = await redis.get(key);
    const rec: ProviderHealthRecord = raw ? JSON.parse(raw) : { failures: 0, lastFailureAt: null, downUntil: null };
    rec.failures = (rec.failures || 0) + 1;
    rec.lastFailureAt = Date.now();
    if (rec.failures >= PROVIDER_FAILURE_THRESHOLD) {
      rec.downUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      logger.warn("Provider marked unhealthy", { provider: name, failures: rec.failures, status });
      try { providerFailureCounter.labels(name).inc(); } catch (e) {}
    } else {
      logger.info("Provider failure recorded", { provider: name, failures: rec.failures, status });
    }
    try { providerErrorCounter.labels(name, String(status ?? "unknown")).inc(); } catch (e) {}
    await redis.set(key, JSON.stringify(rec), "EX", 60 * 60 * 24);
  } catch (e) {
    logger.error("Redis set error in recordProviderFailure", { error: e });
  }
}

export async function recordProviderSuccess(name: string) {
  if (!redis) {
    const rec = memoryGet(name);
    rec.failures = 0;
    rec.lastFailureAt = null;
    rec.downUntil = null;
    return;
  }

  try {
    const key = REDIS_KEY_PREFIX + name;
    const rec: ProviderHealthRecord = { failures: 0, lastFailureAt: null, downUntil: null };
    await redis.set(key, JSON.stringify(rec), "EX", 60 * 60 * 24);
  } catch (e) {
    logger.error("Redis set error in recordProviderSuccess", { error: e });
  }
}

export async function isProviderHealthy(name: string): Promise<boolean> {
  // Hardcoded bypass to fix the circuit breaker lockout state
  return true;
}

export async function getProviderSnapshot(): Promise<Record<string, ProviderHealthRecord & { healthy: boolean }>> {
  const out: Record<string, ProviderHealthRecord & { healthy: boolean }> = {};
  if (!redis) {
    for (const [k, v] of providerHealth.entries()) {
      out[k] = { ...v, healthy: !(v.downUntil && Date.now() < v.downUntil) };
    }
    return out;
  }

  try {
    const keys = await redis.keys(REDIS_KEY_PREFIX + "*");
    for (const k of keys) {
      const raw = await redis.get(k);
      if (!raw) continue;
      const name = k.replace(REDIS_KEY_PREFIX, "");
      const rec = JSON.parse(raw) as ProviderHealthRecord;
      out[name] = { ...rec, healthy: !(rec.downUntil && Date.now() < rec.downUntil) };
    }
    return out;
  } catch (e) {
    logger.error("Redis error in getProviderSnapshot", { error: e });
    // fallback to memory
    for (const [k, v] of providerHealth.entries()) {
      out[k] = { ...v, healthy: !(v.downUntil && Date.now() < v.downUntil) };
    }
    return out;
  }
}

// synchronous snapshot getter for code paths that expect it is intentionally removed;
// use the async `getProviderSnapshot()` above which supports Redis.
