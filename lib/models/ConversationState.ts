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
});

export default mongoose.models.ConversationState || mongoose.model("ConversationState", conversationStateSchema);
