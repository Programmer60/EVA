import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  preferences: [String],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  personalityProfile: {
    verbosity: { type: Number, default: 0.5 },
    curiosityLevel: { type: Number, default: 0.5 },
    emotionalDepth: { type: Number, default: 0.5 },
    humorLevel: { type: Number, default: 0.2 },
  },
});

export default mongoose.models.User || mongoose.model("User", userSchema);
