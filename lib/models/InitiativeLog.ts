import mongoose from "mongoose";

const initiativeLogSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
    enum: ["emotional_checkin", "memory_callback", "casual_ping", "silence"],
  },
  content: {
    type: String,
    default: null, // null for silence entries
  },
  score: {
    type: Number,
    required: true,
  },
  scoreBreakdown: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  userRespondedAt: {
    type: Date,
    default: null,
  },
  userResponded: {
    type: Boolean,
    default: false,
  },
  ignored: {
    type: Boolean,
    default: false,
  },
  providerUsed: {
    type: String,
    default: null,
  },
});

// Compound index for fast lookups: recent initiatives per user
initiativeLogSchema.index({ userId: 1, sentAt: -1 });

export default mongoose.models.InitiativeLog ||
  mongoose.model("InitiativeLog", initiativeLogSchema);
