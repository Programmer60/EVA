/**
 * avatarEngine.ts — Pure logic for EVA's emotionally reactive avatar.
 *
 * Philosophy: "emotionally readable calm presence", NOT "perfect animated face."
 *             EVA is a quiet intelligent presence — like a late-night conversation,
 *             a rainy day companion, a thoughtful listener.
 *
 * Signature state: "thoughtful warmth" — not happy, not neutral, but warm and present.
 *
 * Manages:
 *  - Expression parameter sets per emotion (boosted contrast for readability)
 *  - Presence states (idle, listening, thinking, speaking, emotional_pause)
 *  - Eye attention system (gaze drift, blink timing, pupil behavior)
 *  - Speaking state enhancements (cheek glow, ambient boost)
 *  - Smooth interpolation between expression states
 *  - Idle micro-variations for perceived consciousness
 */

/* ── Types ────────────────────────────────────────────────── */

export interface AvatarExpression {
  eyeOpenness: number;      // 0–1 (0=closed, 1=wide open)
  pupilSize: number;        // 0–1 (relative to iris)
  browAngle: number;        // -1 to 1 (-1=furrowed, 1=raised)
  browHeight: number;       // 0–1 (vertical position, 1=high)
  mouthCurve: number;       // -1 to 1 (-1=frown, 1=smile)
  mouthOpenness: number;    // 0–1 (lip sync override)
  mouthWidth: number;       // 0–1
  cheekGlow: number;        // 0–1 (blush opacity)
  headTilt: number;         // -1 to 1 (slight tilt in degrees)
  irisHue: string;          // CSS color for iris
}

export type AvatarPresenceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "emotional_pause";

export interface GazeTarget {
  x: number;  // -1 to 1 (left to right offset)
  y: number;  // -1 to 1 (up=-1, down=+1)
}

export interface BlinkConfig {
  minInterval: number;  // ms
  maxInterval: number;  // ms
  duration: number;     // ms for close→open
}

/* ── Expression Presets ───────────────────────────────────── */
/*
 * DESIGN RULE: Expressions are BOOSTED for readability.
 * The face must clearly communicate emotion at a glance.
 * "Thoughtful warmth" is the resting state — not flat neutral.
 */

export const EMOTION_EXPRESSIONS: Record<string, AvatarExpression> = {
  // ─── Signature state: thoughtful warmth. EVA's "resting face." ───
  neutral: {
    eyeOpenness: 0.6, pupilSize: 0.48, browAngle: 0.05, browHeight: 0.48,
    mouthCurve: 0.12, mouthOpenness: 0, mouthWidth: 0.48,
    cheekGlow: 0.06, headTilt: 0.02, irisHue: "#8ec5e8",
  },

  // ─── Warm emotions ───
  happy: {
    eyeOpenness: 0.42, pupilSize: 0.52, browAngle: 0.25, browHeight: 0.55,
    mouthCurve: 0.75, mouthOpenness: 0.03, mouthWidth: 0.72,
    cheekGlow: 0.5, headTilt: 0.05, irisHue: "#66e3be",
  },
  excited: {
    eyeOpenness: 0.88, pupilSize: 0.58, browAngle: 0.55, browHeight: 0.72,
    mouthCurve: 0.9, mouthOpenness: 0.08, mouthWidth: 0.78,
    cheekGlow: 0.4, headTilt: 0.06, irisHue: "#ffd166",
  },

  // ─── Heavy emotions (need strongest readability) ───
  sad: {
    eyeOpenness: 0.38, pupilSize: 0.38, browAngle: -0.55, browHeight: 0.28,
    mouthCurve: -0.55, mouthOpenness: 0, mouthWidth: 0.38,
    cheekGlow: 0, headTilt: -0.08, irisHue: "#7090b8",
  },
  angry: {
    eyeOpenness: 0.75, pupilSize: 0.28, browAngle: -0.85, browHeight: 0.22,
    mouthCurve: -0.4, mouthOpenness: 0, mouthWidth: 0.58,
    cheekGlow: 0, headTilt: -0.03, irisHue: "#e87070",
  },
  anxious: {
    eyeOpenness: 0.88, pupilSize: 0.25, browAngle: 0.45, browHeight: 0.7,
    mouthCurve: -0.15, mouthOpenness: 0.02, mouthWidth: 0.4,
    cheekGlow: 0, headTilt: 0, irisHue: "#c4a1ff",
  },

  // ─── EVA's CORE emotions (concern, warmth, curiosity) ───
  concerned: {
    eyeOpenness: 0.72, pupilSize: 0.44, browAngle: -0.45, browHeight: 0.35,
    mouthCurve: -0.2, mouthOpenness: 0, mouthWidth: 0.44,
    cheekGlow: 0.04, headTilt: 0.04, irisHue: "#88a8cc",
  },
  empathetic: {
    eyeOpenness: 0.52, pupilSize: 0.52, browAngle: -0.2, browHeight: 0.42,
    mouthCurve: 0.08, mouthOpenness: 0, mouthWidth: 0.46,
    cheekGlow: 0.15, headTilt: 0.06, irisHue: "#9cc8dd",
  },
  curious: {
    eyeOpenness: 0.78, pupilSize: 0.52, browAngle: 0.5, browHeight: 0.65,
    mouthCurve: 0.08, mouthOpenness: 0, mouthWidth: 0.44,
    cheekGlow: 0, headTilt: 0.14, irisHue: "#83b7ff",
  },

  // ─── Reflective emotions ───
  nostalgic: {
    eyeOpenness: 0.45, pupilSize: 0.44, browAngle: 0.12, browHeight: 0.42,
    mouthCurve: 0.12, mouthOpenness: 0, mouthWidth: 0.44,
    cheekGlow: 0.18, headTilt: -0.06, irisHue: "#b0a0d8",
  },
};

/* ── Presence → Eye Attention ─────────────────────────────── */

/** Base gaze target per presence state (before drift noise is added) */
export const PRESENCE_GAZE: Record<AvatarPresenceState, GazeTarget> = {
  idle:             { x: 0,    y: 0 },
  listening:        { x: 0,    y: 0 },        // steady forward, attentive
  thinking:         { x: 0,    y: 0.18 },     // eyes drift slightly DOWN (contemplative, processing)
  speaking:         { x: 0,    y: 0 },        // gentle drift
  emotional_pause:  { x: 0,    y: 0.25 },     // downward, reflective
};

/** Gaze drift amplitude per state (how much random wander) */
export const PRESENCE_GAZE_DRIFT: Record<AvatarPresenceState, { x: number; y: number; speed: number }> = {
  idle:             { x: 0.15, y: 0.1,  speed: 0.3 },   // gentle random wander
  listening:        { x: 0.05, y: 0.03, speed: 0.12 },   // almost still, focused
  thinking:         { x: 0.06, y: 0.04, speed: 0.04 },   // very slow, contemplative
  speaking:         { x: 0.10, y: 0.04, speed: 0.35 },   // gentle side drift
  emotional_pause:  { x: 0.03, y: 0.03, speed: 0.04 },   // almost frozen
};

/** Eye openness modifier per presence state (adds to base expression) */
export const PRESENCE_EYE_MOD: Record<AvatarPresenceState, number> = {
  idle:             0,
  listening:        0.05,      // slightly more open — attentive
  thinking:        -0.06,      // softer — contemplative
  speaking:         0.02,
  emotional_pause: -0.1,       // noticeably softer, reflective
};

/** Blink timing per presence state */
export const PRESENCE_BLINK: Record<AvatarPresenceState, BlinkConfig> = {
  idle:             { minInterval: 3000, maxInterval: 6000, duration: 150 },
  listening:        { minInterval: 3500, maxInterval: 5500, duration: 140 },
  thinking:         { minInterval: 5000, maxInterval: 8000, duration: 200 },  // noticeably slower
  speaking:         { minInterval: 2800, maxInterval: 5000, duration: 130 },
  emotional_pause:  { minInterval: 4500, maxInterval: 7500, duration: 180 },
};

/**
 * Speaking state modifiers — applied ON TOP of emotion expression during TTS.
 * Subtle: slight cheek warmth + glow boost. Mouth is handled separately.
 */
export const SPEAKING_MODIFIERS = {
  cheekGlowBoost: 0.08,    // subtle warmth while talking
  maxMouthOpenness: 0.25,  // cap lip sync — don't overdo it
};

/**
 * Cursor gaze weight per presence state.
 * How much the pupils follow the user's cursor (0=ignore, 1=fully track).
 * EVA looks at you when attentive, looks away when processing.
 */
export const CURSOR_GAZE_WEIGHT: Record<AvatarPresenceState, number> = {
  idle:             0.55,   // mostly follows cursor — EVA is present with you
  listening:        0.65,   // strongly follows — attentive, looking at you
  thinking:         0.1,    // barely follows — she's processing, eyes drift down
  speaking:         0.35,   // moderate — she looks at you while talking, but not locked
  emotional_pause:  0.0,    // no cursor tracking — fully internal, reflective
};

/** Ambient glow color per emotion — boosted intensity for readability */
export const EMOTION_GLOW: Record<string, string> = {
  neutral:   "rgba(142, 197, 232, 0.14)",  // warm blue (matches thoughtful warmth iris)
  happy:     "rgba(102, 227, 190, 0.22)",
  sad:       "rgba(112, 144, 184, 0.18)",
  angry:     "rgba(232, 112, 112, 0.18)",
  anxious:   "rgba(196, 161, 255, 0.17)",
  excited:   "rgba(255, 209, 102, 0.20)",
  curious:   "rgba(131, 183, 255, 0.18)",
  nostalgic: "rgba(176, 160, 216, 0.17)",
  empathetic:"rgba(156, 200, 221, 0.16)",
  concerned: "rgba(136, 168, 204, 0.16)",
};

/* ── Interpolation ────────────────────────────────────────── */

/**
 * Linearly interpolate between two expressions.
 * `t` is 0–1 where 0=from, 1=to.
 */
export function interpolateExpression(
  from: AvatarExpression,
  to: AvatarExpression,
  t: number,
): AvatarExpression {
  const clamp = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => a + (b - a) * clamp;
  return {
    eyeOpenness:  lerp(from.eyeOpenness, to.eyeOpenness),
    pupilSize:    lerp(from.pupilSize, to.pupilSize),
    browAngle:    lerp(from.browAngle, to.browAngle),
    browHeight:   lerp(from.browHeight, to.browHeight),
    mouthCurve:   lerp(from.mouthCurve, to.mouthCurve),
    mouthOpenness:lerp(from.mouthOpenness, to.mouthOpenness),
    mouthWidth:   lerp(from.mouthWidth, to.mouthWidth),
    cheekGlow:    lerp(from.cheekGlow, to.cheekGlow),
    headTilt:     lerp(from.headTilt, to.headTilt),
    irisHue:      clamp > 0.5 ? to.irisHue : from.irisHue,
  };
}

/**
 * Smooth-step toward target at a given rate (per-frame lerp factor).
 * Use rate ~0.04 for gentle transitions, ~0.12 for snappy.
 */
export function stepToward(
  current: AvatarExpression,
  target: AvatarExpression,
  rate: number,
): AvatarExpression {
  return interpolateExpression(current, target, rate);
}

/* ── Gaze Computation ─────────────────────────────────────── */

/**
 * Compute organic gaze drift from presence state + time.
 * This is the "autonomous" gaze when no cursor input exists.
 */
export function computeAutonomousGaze(
  presenceState: AvatarPresenceState,
  timeMs: number,
): GazeTarget {
  const base = PRESENCE_GAZE[presenceState];
  const drift = PRESENCE_GAZE_DRIFT[presenceState];

  // Two sine waves at different frequencies for organic movement
  const t = timeMs / 1000;
  const driftX = Math.sin(t * drift.speed * 2.1 + 0.7) * drift.x
               + Math.sin(t * drift.speed * 0.8 + 3.1) * drift.x * 0.3;
  const driftY = Math.sin(t * drift.speed * 1.7 + 1.3) * drift.y
               + Math.cos(t * drift.speed * 0.5 + 2.0) * drift.y * 0.4;

  return {
    x: Math.max(-1, Math.min(1, base.x + driftX)),
    y: Math.max(-1, Math.min(1, base.y + driftY)),
  };
}

/**
 * Compute final gaze by blending autonomous drift with cursor-tracking input.
 * cursorGaze is the normalized cursor position relative to avatar center (-1 to 1).
 * The blend weight depends on presence state — EVA looks at you when attentive,
 * but looks away when thinking or reflecting.
 */
export function computeGaze(
  presenceState: AvatarPresenceState,
  timeMs: number,
  cursorGaze: GazeTarget | null,
): GazeTarget {
  const autonomous = computeAutonomousGaze(presenceState, timeMs);

  if (!cursorGaze) return autonomous;

  const weight = CURSOR_GAZE_WEIGHT[presenceState];
  if (weight < 0.01) return autonomous;

  // Blend: weighted average of autonomous drift and cursor position
  return {
    x: Math.max(-1, Math.min(1, autonomous.x * (1 - weight) + cursorGaze.x * weight)),
    y: Math.max(-1, Math.min(1, autonomous.y * (1 - weight) + cursorGaze.y * weight)),
  };
}

/* ── Idle Micro-Variations ────────────────────────────────── */

/**
 * Adds subtle idle micro-movements to create "perceived consciousness."
 * Breathing cycle, subtle brow drift, slight head micro-movement.
 */
export function getIdleVariation(timeMs: number): {
  breatheScale: number;   // 1.0 ± tiny amount for breathing
  browDrift: number;      // tiny additive brow offset
  headDrift: number;      // tiny additive head tilt
} {
  const t = timeMs / 1000;
  return {
    breatheScale: 1 + Math.sin(t * 0.8) * 0.006,       // 4s cycle, very subtle
    browDrift:    Math.sin(t * 0.3 + 1.5) * 0.02,       // very slow brow micro-drift
    headDrift:    Math.sin(t * 0.25 + 0.8) * 0.01,      // barely perceptible tilt drift
  };
}

/* ── Blink Scheduling ─────────────────────────────────────── */

/** Get the next blink interval for a given presence state */
export function getNextBlinkInterval(state: AvatarPresenceState): number {
  const config = PRESENCE_BLINK[state];
  return config.minInterval + Math.random() * (config.maxInterval - config.minInterval);
}

export function getBlinkDuration(state: AvatarPresenceState): number {
  return PRESENCE_BLINK[state].duration;
}

/* ── Expression Lookup ────────────────────────────────────── */

export function getExpressionForEmotion(emotion: string): AvatarExpression {
  return EMOTION_EXPRESSIONS[emotion] ?? EMOTION_EXPRESSIONS.neutral;
}
