/**
 * moodEngine.ts — EVA's Emotional Mood Carryover System.
 *
 * Emotions don't flip like switches. This engine:
 *  - Smooths mood over time (no instant flips)
 *  - Uses emotion-specific decay rates (sadness lingers, happiness fades fast)
 *  - Detects significant mood shifts for EVA to acknowledge
 *  - Carries mood across sessions
 */

import MoodState from "@/lib/models/MoodState";

/* ── Types ────────────────────────────────────────────────── */

export interface MoodContext {
  currentMood: string;
  intensity: number;
  promptText: string;
  shift: MoodShift | null;
}

export interface MoodShift {
  from: string;
  to: string;
  direction: "improving" | "declining" | "lateral";
  hint: string;
}

interface MoodEntry {
  mood: string;
  intensity: number;
  timestamp: Date;
}

/* ── Emotion-Specific Decay Rates ─────────────────────────── */

/**
 * Decay factor PER HOUR of inactivity.
 * Lower = lingers longer. Higher = fades faster.
 *
 * sadness:   0.9^hours → takes ~7h to halve (lingers)
 * happiness: 0.7^hours → takes ~2h to halve (fades fast)
 * anger:     0.75^hours → takes ~2.5h to halve
 * anxiety:   0.85^hours → takes ~4.5h to halve (lingers moderately)
 * neutral:   1.0 → no decay (baseline)
 */
const EMOTION_DECAY_RATES: Record<string, number> = {
  sad: 0.9,
  anxious: 0.85,
  angry: 0.75,
  concerned: 0.85,
  nostalgic: 0.88,
  happy: 0.7,
  excited: 0.65,
  curious: 0.7,
  neutral: 1.0,
  empathetic: 0.8,
};

/** Emotional valence for shift detection (-1 = negative, +1 = positive) */
const EMOTION_VALENCE: Record<string, number> = {
  sad: -1,
  anxious: -0.8,
  angry: -0.9,
  concerned: -0.5,
  nostalgic: -0.3,
  neutral: 0,
  curious: 0.3,
  happy: 0.8,
  excited: 1,
  empathetic: 0.2,
};

const MOOD_HISTORY_LIMIT = 10;
const INTENSITY_FLOOR = 0.1; // below this, mood resets to neutral

/* ── Core Functions ───────────────────────────────────────── */

/**
 * Update the user's mood state with a new emotion reading.
 * Mood doesn't flip instantly — it drifts using weighted blending.
 */
export async function updateMood(
  userId: string,
  newEmotion: string,
  confidence: number,
): Promise<void> {
  let state = await MoodState.findOne({ userId });

  if (!state) {
    state = await MoodState.create({
      userId,
      currentMood: newEmotion,
      moodIntensity: confidence,
      moodHistory: [{ mood: newEmotion, intensity: confidence, timestamp: new Date() }],
      lastUpdated: new Date(),
    });
    return;
  }

  // Apply time-based decay to current mood before blending
  const hoursSinceUpdate = (Date.now() - new Date(state.lastUpdated).getTime()) / (1000 * 60 * 60);
  const decayRate = EMOTION_DECAY_RATES[state.currentMood] ?? 0.8;
  const decayedIntensity = state.moodIntensity * Math.pow(decayRate, hoursSinceUpdate);

  // Blend: new reading is weighted by confidence, old mood by decayed intensity
  const totalWeight = decayedIntensity + confidence;
  let blendedMood: string;
  let blendedIntensity: number;

  if (confidence > decayedIntensity * 0.7) {
    // New emotion is strong enough to shift the mood
    blendedMood = newEmotion;
    blendedIntensity = Math.min(1.0, (decayedIntensity * 0.3 + confidence * 0.7));
  } else {
    // Current mood still dominates
    blendedMood = state.currentMood;
    blendedIntensity = Math.min(1.0, totalWeight / 2);
  }

  // If intensity is floor-level, reset to neutral
  if (blendedIntensity < INTENSITY_FLOOR) {
    blendedMood = "neutral";
    blendedIntensity = 0.5;
  }

  // Update history (keep last N entries)
  const history: MoodEntry[] = [
    ...(state.moodHistory as MoodEntry[] || []),
    { mood: newEmotion, intensity: confidence, timestamp: new Date() },
  ].slice(-MOOD_HISTORY_LIMIT);

  await MoodState.updateOne(
    { userId },
    {
      $set: {
        currentMood: blendedMood,
        moodIntensity: blendedIntensity,
        moodHistory: history,
        lastUpdated: new Date(),
      },
    },
  );
}

/**
 * Get the user's current mood context for prompt injection.
 * Applies time-decay to stored mood before generating text.
 */
export async function getMoodContext(userId: string): Promise<MoodContext> {
  const state = await MoodState.findOne({ userId }).lean();

  if (!state) {
    return {
      currentMood: "neutral",
      intensity: 0.5,
      promptText: "",
      shift: null,
    };
  }

  // Decay current mood based on time since last update
  const hoursSince = (Date.now() - new Date(state.lastUpdated as Date).getTime()) / (1000 * 60 * 60);
  const decayRate = EMOTION_DECAY_RATES[state.currentMood as string] ?? 0.8;
  const decayedIntensity = (state.moodIntensity as number) * Math.pow(decayRate, hoursSince);
  const currentMood = decayedIntensity < INTENSITY_FLOOR ? "neutral" : state.currentMood as string;
  const intensity = decayedIntensity < INTENSITY_FLOOR ? 0.5 : decayedIntensity;

  // Detect mood shift from recent history
  const shift = detectMoodShift(state.moodHistory as MoodEntry[]);

  // Build prompt text
  let promptText = "";
  if (currentMood !== "neutral" && intensity > 0.3) {
    const intensityWord = intensity > 0.7 ? "strongly" : intensity > 0.4 ? "moderately" : "faintly";
    promptText = `User's emotional baseline entering this conversation: ${intensityWord} ${currentMood} (intensity: ${intensity.toFixed(2)}).`;

    if (hoursSince > 2 && currentMood !== "neutral") {
      promptText += ` They were feeling ${currentMood} in their last session (${Math.round(hoursSince)}h ago). This may still linger — approach accordingly.`;
    }
  }

  if (shift) {
    promptText += `\n${shift.hint}`;
  }

  return {
    currentMood,
    intensity,
    promptText,
    shift,
  };
}

/* ── Mood Shift Detection ─────────────────────────────────── */

/**
 * Detect significant mood transitions in recent history.
 * Looks at last 3 entries vs. previous 3 entries.
 */
function detectMoodShift(history: MoodEntry[]): MoodShift | null {
  if (!history || history.length < 4) return null;

  const recent = history.slice(-3);
  const earlier = history.slice(-6, -3);
  if (earlier.length < 2) return null;

  const recentValence = avgValence(recent);
  const earlierValence = avgValence(earlier);
  const delta = recentValence - earlierValence;

  // Need a significant shift (> 0.5 valence change)
  if (Math.abs(delta) < 0.5) return null;

  const fromMood = dominantMood(earlier);
  const toMood = dominantMood(recent);

  if (fromMood === toMood) return null;

  const direction: MoodShift["direction"] =
    delta > 0 ? "improving" : "declining";

  const hint =
    direction === "improving"
      ? `MOOD SHIFT DETECTED: User has been shifting from ${fromMood} toward ${toMood}. If natural, you may gently acknowledge this (e.g., "You sound a bit lighter today."). Do NOT force it.`
      : `MOOD SHIFT DETECTED: User has been shifting from ${fromMood} toward ${toMood}. Be more careful and attentive. Do NOT point out that they seem worse.`;

  return { from: fromMood, to: toMood, direction, hint };
}

function avgValence(entries: MoodEntry[]): number {
  if (entries.length === 0) return 0;
  const total = entries.reduce((sum, e) => sum + (EMOTION_VALENCE[e.mood] ?? 0), 0);
  return total / entries.length;
}

function dominantMood(entries: MoodEntry[]): string {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.mood] = (counts[e.mood] || 0) + 1;
  }
  let best = "neutral";
  let bestCount = 0;
  for (const [mood, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = mood;
      bestCount = count;
    }
  }
  return best;
}
