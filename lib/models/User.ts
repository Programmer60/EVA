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
  topicInterests: {
    type: Map,
    of: new mongoose.Schema({
      baseConfidence: Number,
      recentInterest: Number,
      lastUsed: Date,
      frequency: Number,
    }, { _id: false }),
    default: {}
  },

  // Relationship Layer
  bondScore: { type: Number, default: 0.1 }, // 0 → 1, grows over time
  bondSignals: { type: Number, default: 0 }, // raw count of trust/appreciation signals
  observedPatterns: {
    type: [String], // things EVA has noticed about the user (e.g. "thinks deeply before speaking", "uses humor to deflect")
    default: [],
  },
  lastBondUpdate: { type: Date, default: Date.now },

  // Life Awareness Engine
  lifeEvents: {
    type: [new mongoose.Schema({
      event: String,           // "exams", "interview", "birthday", "trip"
      date: Date,              // when it happens
      importance: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
      context: String,         // extra details: "semester finals at NIT Uttarakhand"
      source: String,          // how EVA learned this: "user mentioned", "inferred"
      lastNudgedAt: Date,      // when EVA last brought this up
      nudgeCount: { type: Number, default: 0 },
      resolved: { type: Boolean, default: false }, // true after event passes
    }, { _id: false })],
    default: [],
  },
  lastLifeNudge: { type: Date, default: null }, // global cooldown for life nudges
});

export default mongoose.models.User || mongoose.model("User", userSchema);

