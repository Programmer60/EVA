import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  userId: String,
  role: String, // user or eva
  content: String,
  emotion: {
    type: String,
    default: "neutral",
  },
  emotionData: {
    label: {
      type: String,
      default: "neutral",
    },
    confidence: {
      type: Number,
      default: null,
    },
    source: {
      type: String,
      default: "heuristic",
    },
    strategy: {
      type: String,
      default: null,
    },
  },
  providerUsed: {
    type: String,
    default: null,
  },
  contextMessages: {
    type: Number,
    default: 0,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
