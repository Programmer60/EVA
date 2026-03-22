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
  lastAccessed: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Memory || mongoose.model("Memory", memorySchema);
