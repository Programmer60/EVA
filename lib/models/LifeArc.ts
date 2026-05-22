import mongoose from "mongoose";

const lifeArcSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  arcKey: { type: String, required: true, index: true },
  title: { type: String, required: true },
  sourceEvent: {
    type: new mongoose.Schema(
      {
        event: String,
        date: Date,
        importance: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
        context: String,
      },
      { _id: false },
    ),
    default: null,
  },
  status: {
    type: String,
    enum: ["seeded", "active", "building", "closing", "resolved"],
    default: "seeded",
    index: true,
  },
  phase: {
    type: String,
    enum: ["seed", "develop", "peak", "resolve"],
    default: "seed",
  },
  importance: {
    type: String,
    enum: ["low", "medium", "high", "critical"],
    default: "medium",
  },
  startDate: { type: Date, default: Date.now },
  targetDate: { type: Date, default: null },
  lastMentionedAt: { type: Date, default: Date.now },
  mentionCount: { type: Number, default: 0 },
  resolvedAt: { type: Date, default: null },
  notes: { type: [String], default: [] },
  promptCue: { type: String, default: "" },
});

lifeArcSchema.index({ userId: 1, status: 1, lastMentionedAt: -1 });
lifeArcSchema.index({ userId: 1, arcKey: 1 }, { unique: true });

export default mongoose.models.LifeArc || mongoose.model("LifeArc", lifeArcSchema);
