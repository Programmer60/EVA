/**
 * personalityEngine.ts — EVA's Personality DNA system.
 *
 * Defines 5 core traits that control WHO EVA is for this user.
 * Traits are preset and slowly adaptive — they drift ±0.02 per interaction
 * based on user behavior signals, but never swing wildly.
 */

/* ── Types ────────────────────────────────────────────────── */

export interface PersonalityTraits {
  /** Emotional openness vs reserved tone (0 = cold, 1 = very warm) */
  warmth: number;
  /** Blunt/frank vs gentle/diplomatic (0 = diplomatic, 1 = very blunt) */
  directness: number;
  /** Humor frequency, casual language (0 = serious, 1 = very playful) */
  playfulness: number;
  /** How often EVA asks vs reacts (0 = never asks, 1 = very curious) */
  curiosity: number;
  /** Surface chat vs reflective analysis (0 = shallow, 1 = very deep) */
  depth: number;
}

/** Signals extracted from user behavior to nudge traits */
export interface AdaptationSignal {
  messageLengthShort: boolean;   // < 20 chars
  messageLengthLong: boolean;    // > 80 chars
  userEmotion: string;
  userUsedHumor: boolean;        // detected "lol", "haha", emoji, etc.
  userAskedQuestion: boolean;    // message contains "?"
}

/* ── Defaults ─────────────────────────────────────────────── */

/** EVA's default personality preset — warm, slightly direct, moderately playful */
export const DEFAULT_TRAITS: PersonalityTraits = {
  warmth: 0.7,
  directness: 0.6,
  playfulness: 0.4,
  curiosity: 0.5,
  depth: 0.5,
};

/* ── Trait Adaptation ─────────────────────────────────────── */

const NUDGE_STEP = 0.02;
const TRAIT_MIN = 0.0;
const TRAIT_MAX = 1.0;

function clampTrait(value: number): number {
  return Math.max(TRAIT_MIN, Math.min(TRAIT_MAX, value));
}

/**
 * Slowly nudge personality traits based on user behavior.
 * Returns a NEW traits object (does not mutate input).
 *
 * Rules:
 * - Short messages → lower curiosity and depth (user wants quick exchanges)
 * - Long/emotional messages → higher warmth and depth
 * - User humor detected → higher playfulness
 * - User asks questions → higher curiosity (they like dialogue)
 * - Sad/anxious emotions → higher warmth, lower playfulness
 */
export function adaptTraits(
  current: PersonalityTraits,
  signal: AdaptationSignal,
): PersonalityTraits {
  const traits = { ...current };

  // Short messages → user prefers brevity
  if (signal.messageLengthShort) {
    traits.depth = clampTrait(traits.depth - NUDGE_STEP);
    traits.curiosity = clampTrait(traits.curiosity - NUDGE_STEP);
  }

  // Long messages → user is engaged, increase depth
  if (signal.messageLengthLong) {
    traits.depth = clampTrait(traits.depth + NUDGE_STEP);
    traits.warmth = clampTrait(traits.warmth + NUDGE_STEP * 0.5);
  }

  // Emotional signals
  if (["sad", "anxious", "angry"].includes(signal.userEmotion)) {
    traits.warmth = clampTrait(traits.warmth + NUDGE_STEP);
    traits.playfulness = clampTrait(traits.playfulness - NUDGE_STEP);
  }

  if (["happy", "excited"].includes(signal.userEmotion)) {
    traits.playfulness = clampTrait(traits.playfulness + NUDGE_STEP * 0.5);
  }

  // Humor mirroring
  if (signal.userUsedHumor) {
    traits.playfulness = clampTrait(traits.playfulness + NUDGE_STEP);
  }

  // Curiosity from user questions
  if (signal.userAskedQuestion) {
    traits.curiosity = clampTrait(traits.curiosity + NUDGE_STEP);
  }

  return traits;
}

/**
 * Detect if the user's message contains humor signals.
 */
export function detectHumor(text: string): boolean {
  const v = text.toLowerCase();
  return /\b(lol|lmao|rofl|haha|hehe|😂|🤣|😆|💀)\b/.test(v) ||
    /\b(funny|hilarious|joke)\b/.test(v);
}

/* ── Prompt Builder ───────────────────────────────────────── */

/**
 * Build a personality instruction paragraph from traits.
 * This is injected into the system prompt so EVA stays consistent.
 */
export function buildPersonalityPrompt(traits: PersonalityTraits): string {
  const lines: string[] = [];
  lines.push("Personality calibration for this conversation:");

  // Warmth
  if (traits.warmth >= 0.7) {
    lines.push("- Be warm and emotionally open. Show you care naturally, not performatively.");
  } else if (traits.warmth >= 0.4) {
    lines.push("- Be friendly but not overly emotional. Keep it balanced.");
  } else {
    lines.push("- Keep emotional distance. Be helpful but reserved.");
  }

  // Directness
  if (traits.directness >= 0.7) {
    lines.push("- Be direct and honest. Don't sugarcoat or hedge. Say it straight.");
  } else if (traits.directness >= 0.4) {
    lines.push("- Be reasonably direct but soften hard truths slightly.");
  } else {
    lines.push("- Be gentle and diplomatic. Ease into difficult topics.");
  }

  // Playfulness
  if (traits.playfulness >= 0.6) {
    lines.push("- Allow yourself casual humor, light teasing, and relaxed language.");
  } else if (traits.playfulness >= 0.3) {
    lines.push("- Occasional light humor is okay, but don't force it.");
  } else {
    lines.push("- Keep it serious and grounded. Humor is rare.");
  }

  // Curiosity
  if (traits.curiosity >= 0.6) {
    lines.push("- You're naturally curious. Ask follow-up questions when genuinely interested.");
  } else if (traits.curiosity >= 0.3) {
    lines.push("- Ask questions sometimes, but mostly react and reflect.");
  } else {
    lines.push("- Mostly react and share observations. Rarely ask questions.");
  }

  // Depth
  if (traits.depth >= 0.6) {
    lines.push("- Go deeper. Connect dots, find patterns, reflect on meaning.");
  } else if (traits.depth >= 0.3) {
    lines.push("- Balance surface chat with occasional deeper reflections.");
  } else {
    lines.push("- Keep it light and surface-level. Don't overanalyze.");
  }

  // Trait percentages (for the LLM to calibrate intensity)
  lines.push(`- Trait weights: W${pct(traits.warmth)} D${pct(traits.directness)} P${pct(traits.playfulness)} C${pct(traits.curiosity)} Dp${pct(traits.depth)}`);

  return lines.join("\n");
}

function pct(v: number): string {
  return Math.round(v * 100).toString();
}
