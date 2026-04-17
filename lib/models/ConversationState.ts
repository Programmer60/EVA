import mongoose from "mongoose";

const conversationStateSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  stage: { type: String, enum: ["START", "BUILD", "DEEP", "COOLDOWN"], default: "START" },
  topic: { type: String, default: "general" },
  emotion: { type: String, default: "neutral" },
  lastEmotion: { type: String, default: "neutral" },
  lastMode: { type: String, enum: ["reaction", "reflection", "question", "sit"], default: "reaction" },
  lastOpinionStyle: { type: String, enum: ["direct", "reflective", "casual", "emotional"], default: "casual" },
  lastReplyLength: { type: String, enum: ["short", "normal", "extended"], default: "normal" },
  turnCount: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },

  // Conversational Mode Engine
  conversationMode: {
    type: String,
    enum: ["real", "imagined", "emotional", "philosophical"],
    default: "real",
  },
  sceneContext: {
    type: new mongoose.Schema({
      sceneType: String,    // e.g. "cooking", "building", "adventure"
      object: String,       // e.g. "sandwich", "tea", "campfire"
      state: String,        // e.g. "preparing", "cooking", "ready"
      details: String,      // free-form sensory details from the scene
    }, { _id: false }),
    default: null,
  },
  modeMomentum: { type: Number, default: 0 }, // 0 = no inertia, higher = stronger lock
  consecutiveQuestionTurns: { type: Number, default: 0 }, // tracks how many turns in a row had questions
  lastDepthLevel: { type: String, enum: ["casual", "normal", "deep"], default: "normal" },
  lastToneStyle: { type: String, enum: ["calm", "playful", "direct", "soft", "observational"], default: "calm" },

  // Conversational Threading — captures key moments from the current session
  sessionThreads: {
    type: [new mongoose.Schema({
      topic: String,
      gist: String,        // short 1-line summary of what they said
      emotion: String,     // how they felt about it
      turnNumber: Number,
    }, { _id: false })],
    default: [],
  },

  // Emotional Memory — how the user feels about recurring topics
  topicEmotionMap: {
    type: Map,
    of: new mongoose.Schema({
      lastEmotion: String,
      frequency: Number,
      trend: { type: String, enum: ["stable", "improving", "worsening"], default: "stable" },
    }, { _id: false }),
    default: {},
  },

  // Self-disclosure guardrails
  disclosureCount: { type: Number, default: 0 },     // per session, max 2
  lastDisclosureTurn: { type: Number, default: -10 }, // min 6 turn gap
});

export default mongoose.models.ConversationState || mongoose.model("ConversationState", conversationStateSchema);
