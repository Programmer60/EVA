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
    warmth: { type: Number, default: 0.7 },
    directness: { type: Number, default: 0.6 },
    playfulness: { type: Number, default: 0.4 },
    curiosity: { type: Number, default: 0.5 },
    depth: { type: Number, default: 0.5 },
  },
});

export default mongoose.models.User || mongoose.model("User", userSchema);

