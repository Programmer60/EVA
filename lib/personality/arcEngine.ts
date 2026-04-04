/**
 * arcEngine.ts — EVA's Conversation Arc & Momentum System.
 *
 * Tracks session-level phases (greeting → warmup → engaged → deep → winding_down)
 * and emotional momentum with exponentially weighted scoring.
 */

/* ── Types ────────────────────────────────────────────────── */

export type ArcPhase = "greeting" | "warmup" | "engaged" | "deep" | "winding_down";
export type Momentum = "low" | "stable" | "high";

export interface ArcContext {
  phase: ArcPhase;
  momentum: Momentum;
  momentumScore: number;
  promptText: string;
}

/* ── Session Detection ────────────────────────────────────── */

const SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours = new session

/**
 * Determine the current conversation arc phase.
 *
 * @param sessionMessageCount — how many messages in the current session
 * @param lastMessageTimestamp — when the previous message was sent (null = first ever)
 * @param isEmotionalTopic — whether the current topic is emotionally charged
 */
export function getSessionArc(
  sessionMessageCount: number,
  lastMessageTimestamp: Date | null,
  isEmotionalTopic: boolean,
): ArcPhase {
  // New session detection
  const isNewSession =
    !lastMessageTimestamp ||
    Date.now() - new Date(lastMessageTimestamp).getTime() > SESSION_GAP_MS;

  if (isNewSession || sessionMessageCount <= 2) {
    return "greeting";
  }

  if (sessionMessageCount <= 4) {
    return "warmup";
  }

  // Emotional topics push into "deep" earlier
  if (isEmotionalTopic && sessionMessageCount >= 5) {
    return "deep";
  }

  if (sessionMessageCount <= 12) {
    return "engaged";
  }

  if (sessionMessageCount <= 20) {
    return "deep";
  }

  return "winding_down";
}

/* ── Emotional Momentum ───────────────────────────────────── */

/** Emotional valence for momentum scoring */
const VALENCE: Record<string, number> = {
  sad: -1,
  angry: -1,
  anxious: -0.8,
  concerned: -0.5,
  nostalgic: -0.3,
  neutral: 0,
  curious: 0.3,
  empathetic: 0.2,
  happy: 0.8,
  excited: 1,
};

/**
 * Compute emotional momentum from recent emotions.
 * Uses exponential weighting: most recent emotions count 3x more than older ones.
 */
export function getEmotionalMomentum(recentEmotions: string[]): {
  momentum: Momentum;
  score: number;
} {
  if (recentEmotions.length === 0) {
    return { momentum: "stable", score: 0 };
  }

  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < recentEmotions.length; i++) {
    // Exponential weight: more recent = heavier
    // Last emotion gets weight 3, first gets weight ~1
    const weight = 1 + (2 * i) / Math.max(1, recentEmotions.length - 1);
    const valence = VALENCE[recentEmotions[i]] ?? 0;
    weightedSum += valence * weight;
    weightTotal += weight;
  }

  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const momentum: Momentum =
    score < -0.3 ? "low" : score > 0.3 ? "high" : "stable";

  return { momentum, score };
}

/* ── Prompt Builder ───────────────────────────────────────── */

/**
 * Build the arc section of the system prompt.
 * Combines session phase + momentum + optional mood context.
 */
export function buildArcPrompt(
  phase: ArcPhase,
  momentum: Momentum,
  moodPromptText: string,
): string {
  const phaseInstructions: Record<ArcPhase, string> = {
    greeting:
      "This is the START of a session. Be warm, acknowledge them naturally. If mood context suggests lingering emotion from a previous session, reference it gently (e.g., \"Hey... how are you doing after earlier?\"). Keep it short.",
    warmup:
      "Session is WARMING UP. Build rapport lightly. Don't dive deep yet. Match their energy level.",
    engaged:
      "Session is ENGAGED. Full depth is appropriate. Use memory references, ask meaningful questions when curious, explore topics naturally.",
    deep:
      "Session is in DEEP mode. Maximum reflection. Give them space. Fewer questions, more observations and sitting with heavy moments.",
    winding_down:
      "Session is WINDING DOWN. Lighter tone. Natural closing energy. Don't push new deep topics. It's okay to let the conversation breathe.",
  };

  const momentumInstructions: Record<Momentum, string> = {
    low: "User emotional momentum is LOW. Avoid forced brightness or playful tone. Meet them where they are.",
    stable: "User emotional momentum is STABLE. Normal conversational energy.",
    high: "User emotional momentum is HIGH. Allow curiosity, lightness, and matched energy.",
  };

  const lines: string[] = [
    `\nConversation Arc: ${phase.toUpperCase()} phase.`,
    phaseInstructions[phase],
    momentumInstructions[momentum],
  ];

  if (moodPromptText) {
    lines.push(moodPromptText);
  }

  return lines.join("\n");
}
