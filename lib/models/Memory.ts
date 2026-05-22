import mongoose from "mongoose";

const memorySchema = new mongoose.Schema({
  userId: {
    type: String,
    index: true,
  },
  key: String,
  value: String,
  importance: {
    type: Number,
    default: 1,
  },
  source: {
    type: String,
    default: "chat",
  },
  type: {
    type: String,
    default: "fact",
    enum: ["preference", "fact", "summary", "emotion"],
  },
  /** Memory protection tier — controls pruning behavior */
  memoryTier: {
    type: String,
    default: "CONTEXT",
    enum: ["CORE", "PREFERENCE", "CONTEXT", "NOISE"],
  },
  accessCount: {
    type: Number,
    default: 0,
  },
  memoryMentionCount: {
    type: Number,
    default: 0,
  },
  lastMentionedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastAccessed: {
    type: Date,
    default: Date.now,
  },
  /** Soft-delete timestamp — null means active */
  deletedAt: {
    type: Date,
    default: null,
  },
});

export default mongoose.models.Memory || mongoose.model("Memory", memorySchema);

