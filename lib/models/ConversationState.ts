import mongoose from "mongoose";

const conversationStateSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  stage: { type: String, enum: ["START", "BUILD", "DEEP", "COOLDOWN"], default: "START" },
  topic: { type: String, default: "general" },
  emotion: { type: String, default: "neutral" },
  lastEmotion: { type: String, default: "neutral" },
  lastMode: { type: String, enum: ["reaction", "reflection", "question", "sit"], default: "reaction" },
  lastOpinionStyle: { type: String, enum: ["direct", "reflective", "casual", "emotional"], default: "casual" },
  turnCount: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

export default mongoose.models.ConversationState || mongoose.model("ConversationState", conversationStateSchema);
