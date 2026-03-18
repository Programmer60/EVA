import mongoose from "mongoose";

const memorySchema = new mongoose.Schema({
  userId: String,
  key: String,
  value: String,
  importance: Number,
  lastAccessed: Date,
});

export default mongoose.models.Memory || mongoose.model("Memory", memorySchema);
