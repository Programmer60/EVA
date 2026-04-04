import mongoose from "mongoose";

const moodEntrySchema = new mongoose.Schema(
  {
    mood: { type: String, required: true },
    intensity: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const moodStateSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  currentMood: { type: String, default: "neutral" },
  moodIntensity: { type: Number, default: 0.5 },
  moodHistory: {
    type: [moodEntrySchema],
    default: [],
  },
  lastUpdated: { type: Date, default: Date.now },
});

export default mongoose.models.MoodState ||
  mongoose.model("MoodState", moodStateSchema);
