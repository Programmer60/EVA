import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: String,
  preferences: [String],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.User || mongoose.model("User", userSchema);
