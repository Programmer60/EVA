/**
 * memoryHygiene.ts — EVA's Memory Cleanup and Protection System.
 *
 * Tiered memory management:
 *  CORE       → never delete (name, identity)
 *  PREFERENCE → rarely delete (likes, dislikes)
 *  CONTEXT    → prune aggressively (talked about X)
 *  NOISE      → delete fast ("so much", "you EVA")
 *
 * Features:
 *  - Importance decay over time (unused memories fade)
 *  - Tiered pruning (respects memory hierarchy)
 *  - Deduplication (token overlap detection)
 *  - Reinforcement (used memories get importance boost)
 *  - Soft-delete (recoverable)
 */

import Memory from "@/lib/models/Memory";

/* ── Types ────────────────────────────────────────────────── */

interface MemoryDoc {
  _id: unknown;
  userId: string;
  key: string;
  value: string;
  importance: number;
  memoryTier?: string;
  accessCount: number;
  createdAt: Date;
  lastAccessed: Date;
  deletedAt: Date | null;
}

/* ── Tier Classification ──────────────────────────────────── */

/**
 * Classify a memory's tier based on its key and value.
 * This is called when memories are created/upserted to set the right tier.
 */
export function classifyMemoryTier(key: string, value: string): string {
  const k = key.toLowerCase();
  const v = value.toLowerCase();

  // CORE: identity-critical facts
  if (k === "name" || k === "user_name" || k.startsWith("identity:")) {
    return "CORE";
  }

  // CORE: conversation summary (valuable long-term context)
  if (k === "conversation_summary") {
    return "CORE";
  }

  // PREFERENCE: likes, dislikes, interests
  if (
    k.startsWith("preference:") ||
    k === "likes" ||
    k === "dislikes" ||
    k === "preferences"
  ) {
    return "PREFERENCE";
  }

  // NOISE: known garbage patterns
  if (isNoiseValue(v)) {
    return "NOISE";
  }

  // Default: CONTEXT
  return "CONTEXT";
}

/**
 * Detect if a value is noise/garbage that should never be stored.
 */
function isNoiseValue(value: string): boolean {
  const v = value.toLowerCase().trim();
  if (v.length < 4) return true;

  const noisePatterns = [
    "so much", "it too", "that", "this", "things", "stuff",
    "everything", "it", "them", "those", "these", "something",
    "anything", "nothing", "a lot", "very much", "really",
    "too much", "so many", "a bit", "stop mike", "stop mic",
    "start mike", "start mic", "testing", "voice reply",
    "stop voice", "type instead", "microphone", "you eva",
    "you, eva", "his famous quote", "her famous quote",
    "the quote",
  ];

  if (noisePatterns.includes(v)) return true;

  // Reject if entirely stop words / filler
  const meaningful = v
    .replace(
      /\b(the|a|an|is|it|and|or|but|to|of|in|for|on|my|i|so|too|very|really|just|also|that|this)\b/gi,
      "",
    )
    .trim();
  if (meaningful.length < 3) return true;

  // Reject single affirmation words
  if (/^(yes|no|ok|okay|maybe|sure|thanks|please|hi|hello|hey)$/i.test(v)) return true;

  return false;
}

/* ── Importance Decay ─────────────────────────────────────── */

const DECAY_RATE_PER_DAY = 0.03; // importance drops 0.03/day when unused
const DECAY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // run at most once per 6h per user

/**
 * Decay importance of stale memories.
 * CORE memories are exempt. NOISE decays 3x faster.
 */
export async function decayMemories(userId: string): Promise<number> {
  const now = new Date();
  const memories = (await Memory.find({
    userId,
    deletedAt: null,
    memoryTier: { $ne: "CORE" },
  }).lean()) as MemoryDoc[];

  let decayedCount = 0;

  for (const mem of memories) {
    const daysSinceAccess =
      (now.getTime() - new Date(mem.lastAccessed).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceAccess < 1) continue; // accessed recently, skip

    const tierMultiplier = mem.memoryTier === "NOISE" ? 3 : mem.memoryTier === "CONTEXT" ? 1.5 : 1;
    const decay = DECAY_RATE_PER_DAY * daysSinceAccess * tierMultiplier;
    const newImportance = Math.max(0, mem.importance - decay);

    if (newImportance !== mem.importance) {
      await Memory.updateOne(
        { _id: mem._id },
        { $set: { importance: newImportance } },
      );
      decayedCount++;
    }
  }

  return decayedCount;
}

/* ── Tiered Pruning ───────────────────────────────────────── */

/**
 * Prune memories based on their tier:
 *  NOISE     → hard delete immediately
 *  CONTEXT   → soft-delete if importance ≤ 0.1 and not accessed in 30+ days
 *  PREFERENCE→ soft-delete if importance ≤ 0.1 and not accessed in 60+ days
 *  CORE      → NEVER delete
 */
export async function pruneMemories(userId: string): Promise<{
  noiseDeleted: number;
  contextPruned: number;
  preferencePruned: number;
}> {
  const now = new Date();

  // 1. Hard-delete NOISE
  const noiseResult = await Memory.deleteMany({
    userId,
    memoryTier: "NOISE",
  });

  // 2. Soft-delete stale CONTEXT
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const contextResult = await Memory.updateMany(
    {
      userId,
      memoryTier: "CONTEXT",
      deletedAt: null,
      importance: { $lte: 0.1 },
      lastAccessed: { $lt: thirtyDaysAgo },
    },
    { $set: { deletedAt: now } },
  );

  // 3. Soft-delete very stale PREFERENCE
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const prefResult = await Memory.updateMany(
    {
      userId,
      memoryTier: "PREFERENCE",
      deletedAt: null,
      importance: { $lte: 0.1 },
      lastAccessed: { $lt: sixtyDaysAgo },
    },
    { $set: { deletedAt: now } },
  );

  return {
    noiseDeleted: noiseResult.deletedCount ?? 0,
    contextPruned: contextResult.modifiedCount ?? 0,
    preferencePruned: prefResult.modifiedCount ?? 0,
  };
}

/* ── Deduplication ────────────────────────────────────────── */

/**
 * Find and remove duplicate memories with >80% token overlap within the same key prefix.
 * Keeps the one with highest importance.
 */
export async function deduplicateMemories(userId: string): Promise<number> {
  const memories = (await Memory.find({
    userId,
    deletedAt: null,
  }).lean()) as MemoryDoc[];

  const toDelete: unknown[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    const a = memories[i];
    if (checked.has(String(a._id))) continue;

    const aTokens = tokenize(a.value);

    for (let j = i + 1; j < memories.length; j++) {
      const b = memories[j];
      if (checked.has(String(b._id))) continue;

      // Only compare within same key prefix
      const aPrefix = a.key.split(":").slice(0, 2).join(":");
      const bPrefix = b.key.split(":").slice(0, 2).join(":");
      if (aPrefix !== bPrefix) continue;

      const bTokens = tokenize(b.value);
      const overlap = tokenOverlap(aTokens, bTokens);

      if (overlap > 0.8) {
        // Keep the one with higher importance
        const loser = a.importance >= b.importance ? b : a;
        toDelete.push(loser._id);
        checked.add(String(loser._id));
      }
    }
  }

  if (toDelete.length > 0) {
    await Memory.updateMany(
      { _id: { $in: toDelete } },
      { $set: { deletedAt: new Date() } },
    );
  }

  return toDelete.length;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) {
    if (b.has(word)) shared++;
  }
  return shared / Math.min(a.size, b.size);
}

/* ── Reinforcement ────────────────────────────────────────── */

/**
 * Boost a memory's importance when it gets used again (referenced in context).
 * This is called automatically when memories are accessed for prompt injection.
 */
export async function reinforceMemory(memoryId: unknown): Promise<void> {
  await Memory.updateOne(
    { _id: memoryId },
    {
      $inc: { importance: 0.5, accessCount: 1 },
      $set: { lastAccessed: new Date() },
    },
  );
}

/* ── Full Hygiene Pass (throttled) ────────────────────────── */

const lastHygieneRun = new Map<string, number>();

/**
 * Run full memory hygiene for a user (decay + prune + dedup).
 * Throttled: max once per 6 hours per user.
 */
export async function runMemoryHygiene(userId: string): Promise<boolean> {
  const now = Date.now();
  const lastRun = lastHygieneRun.get(userId) ?? 0;

  if (now - lastRun < DECAY_COOLDOWN_MS) {
    return false; // too soon
  }

  lastHygieneRun.set(userId, now);

  await decayMemories(userId);
  await pruneMemories(userId);
  await deduplicateMemories(userId);

  return true;
}
