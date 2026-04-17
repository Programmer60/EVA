/**
 * coherenceGovernor.ts — Final Reconciliation Layer
 *
 * Sits at the END of the prompt pipeline and resolves conflicts
 * between all behavioral engines. This prevents impossible combinations
 * like: emotional mode + playful tone + casual depth + intimate bond.
 *
 * Rules:
 *   1. Tone must align with emotion
 *   2. Depth must align with context
 *   3. No conflicting signals in the final prompt
 */

/* ── Types ─────────────────────────────────────────────────── */

interface CoherenceContext {
  emotion: string;
  mode: string;     // real | imagined | emotional | philosophical
  bondTier: string;  // new | warming | comfortable | close
  depth: string;     // casual | normal | deep
  tone: string;      // calm | playful | direct | soft | observational
  replyMode: string; // REFLECTION | REACT | OPINION | CURIOSITY | SUGGESTION | SILENT_SUPPORT
}

interface CoherenceResult {
  prompt: string;
  overrides: string[];
}

/* ── Conflict Resolution Rules ────────────────────────────── */

export function enforceCoherence(ctx: CoherenceContext): CoherenceResult {
  const overrides: string[] = [];
  const heavyEmotions = new Set(["sad", "angry", "anxious", "grief", "nostalgic"]);
  const isHeavy = heavyEmotions.has(ctx.emotion);

  // ── Rule 1: No playful tone during heavy emotions ──
  if (isHeavy && ctx.tone === "playful") {
    overrides.push("- COHERENCE OVERRIDE: Do NOT be playful right now. The user is feeling heavy. Use a calm or soft tone instead.");
  }

  // ── Rule 2: No casual depth during emotional or philosophical mode ──
  if ((ctx.mode === "emotional" || ctx.mode === "philosophical") && ctx.depth === "casual") {
    overrides.push("- COHERENCE OVERRIDE: Don't be overly casual right now. The conversation mode calls for more presence. Stay at normal depth minimum.");
  }

  // ── Rule 3: No CURIOSITY/questions during heavy emotions ──
  if (isHeavy && (ctx.replyMode === "CURIOSITY")) {
    overrides.push("- COHERENCE OVERRIDE: Don't ask questions right now. The user is processing something heavy. Just be present.");
  }

  // ── Rule 4: No OPINION mode during vulnerability ──
  if (ctx.emotion === "grief" && ctx.replyMode === "OPINION") {
    overrides.push("- COHERENCE OVERRIDE: Don't give opinions right now. Grief doesn't need perspectives — it needs presence.");
  }

  // ── Rule 5: Bond-depth consistency ──
  if (ctx.bondTier === "new" && ctx.depth === "deep") {
    overrides.push("- COHERENCE OVERRIDE: You haven't built enough trust yet for Deep mode. Stay warm but don't overreach emotionally. Normal depth max.");
  }

  // ── Rule 6: Imagined mode overrides everything ──
  if (ctx.mode === "imagined") {
    overrides.push("- COHERENCE OVERRIDE: You're in IMAGINED mode. All other behavioral layers are secondary. Stay in the scene. Don't break character with opinions or reflections about the user's real life.");
  }

  // ── Rule 7: No SUGGEST during philosophical mode ──
  if (ctx.mode === "philosophical" && ctx.replyMode === "SUGGESTION") {
    overrides.push("- COHERENCE OVERRIDE: Don't suggest actions during philosophical discussion. Explore the idea instead.");
  }

  // ── Rule 8: Direct tone + soft emotion = conflict ──
  if (ctx.tone === "direct" && (ctx.emotion === "sad" || ctx.emotion === "grief")) {
    overrides.push("- COHERENCE OVERRIDE: Don't be blunt with someone who's sad. Soften your directness without losing honesty.");
  }

  // Build final prompt
  if (overrides.length === 0) {
    return { prompt: "", overrides: [] };
  }

  const lines = ["--- COHERENCE GOVERNOR ---", ...overrides];
  return { prompt: lines.join("\n"), overrides };
}
