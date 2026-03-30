import mongoose from "mongoose";

const trainingInteractionSchema = new mongoose.Schema({
  userId: String,
  sessionId: {
    type: String,
    default: null,
  },
  input: String,
  predictedUserEmotion: String,
  actualUserEmotion: {
    type: String,
    default: null,
  },
  reply: String,
  replyEmotion: String,
  feedbackScore: {
    type: Number, // 1 for thumbs up, -1 for thumbs down, 0 for none
    default: 0,
  },
  memoryUsed: {
    type: Boolean,
    default: false,
  },
  responseTimeMs: {
    type: Number,
    default: 0,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.TrainingInteraction ||
  mongoose.model("TrainingInteraction", trainingInteractionSchema);
