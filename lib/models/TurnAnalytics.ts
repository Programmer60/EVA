import mongoose from "mongoose";

/**
 * TurnAnalytics — captures the behavioral fingerprint of every conversation turn.
 *
 * Stores the decisions EVA's engines make (reply mode, tone, depth, etc.)
 * alongside detection results, bond context, memory metrics, and quality
 * signals so they can be queried later for introspection, tuning, and
 * longitudinal analysis.
 */
const turnAnalyticsSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },

  // ── Behavioral decisions ──────────────────────────────────────────────
  replyMode: String, // REFLECTION | REACT | OPINION | CURIOSITY | SUGGESTION | SILENT_SUPPORT | DIRECT_ACTION | CHALLENGE
  toneStyle: String, // calm | playful | direct | soft | observational
  depthLevel: String, // casual | normal | deep
  conversationMode: String, // real | imagined | emotional | philosophical
  arcPhase: String, // greeting | warmup | engaged | deep | winding_down

  // ── Detection results ─────────────────────────────────────────────────
  subtextDetected: String, // insecurity | suppression | overwhelm | guilt | comparison | directionlessness | nostalgia | null
  isLowSignal: Boolean,

  // ── Context snapshot ──────────────────────────────────────────────────
  bondTier: String, // new | warming | comfortable | close
  bondScore: Number,
  emotionalMomentum: String, // improving | declining | stable | lateral
  moodAtTime: String,
  userEmotion: String,
  userEmotionConfidence: Number,
  replyEmotion: String,

  // ── Memory metrics ────────────────────────────────────────────────────
  memoriesRetrieved: { type: Number, default: 0 },
  memoriesTriggered: { type: Number, default: 0 },
  memoryKeysUsed: [String],

  // ── Quality signals ───────────────────────────────────────────────────
  replyLength: Number,
  responseTimeMs: Number,
  providerUsed: String,
  coherenceOverrides: [String],
});

// Compound index for efficient per-user time-series queries
turnAnalyticsSchema.index({ userId: 1, timestamp: -1 });

export default mongoose.models.TurnAnalytics ||
  mongoose.model("TurnAnalytics", turnAnalyticsSchema);
