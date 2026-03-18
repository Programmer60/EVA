import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  userId: String,
  role: String, // user or eva
  content: String,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
