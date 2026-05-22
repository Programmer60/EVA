import User from "@/lib/models/User";
import ConversationState from "@/lib/models/ConversationState";
import Memory from "@/lib/models/Memory";
import TurnAnalytics from "@/lib/models/TurnAnalytics";
import LifeArc from "@/lib/models/LifeArc";

export type ComputedUserProfile = {
  userId: string;
  bondTier: "new" | "warming" | "comfortable" | "close";
  bondScore: number;
  dominantEmotion: string;
  dominantReplyMode: string;
  dominantTone: string;
  activeArcs: number;
  recurringTopics: string[];
  recentMemories: string[];
  observedPatterns: string[];
  summary: string;
};

function resolveBondTier(bondScore: number): ComputedUserProfile["bondTier"] {
  if (bondScore >= 0.8) return "close";
  if (bondScore >= 0.55) return "comfortable";
  if (bondScore >= 0.3) return "warming";
  return "new";
}

function normalizeMode(mode?: string | null): string {
  if (!mode) return "reaction";
  return mode.trim().toLowerCase();
}

export async function buildUserProfile(userId: string): Promise<{
  profile: ComputedUserProfile | null;
  prompt: string;
}> {
  const [user, conversationState, recentTurns, recentMemories, activeArcs] = await Promise.all([
    User.findOne({ userId }).lean(),
    ConversationState.findOne({ userId }).lean(),
    TurnAnalytics.find({ userId }).sort({ timestamp: -1 }).limit(12).lean(),
    Memory.find({ userId, deletedAt: null }).sort({ importance: -1, lastAccessed: -1 }).limit(6).lean(),
    LifeArc.countDocuments({ userId, status: { $ne: "resolved" } }),
  ]);

  if (!user && !conversationState && recentTurns.length === 0 && recentMemories.length === 0) {
    return { profile: null, prompt: "" };
  }

  const emotionCounts = new Map<string, number>();
  const replyModeCounts = new Map<string, number>();
  const toneCounts = new Map<string, number>();

  for (const turn of recentTurns) {
    const emotion = String(turn.replyEmotion ?? turn.userEmotion ?? "neutral");
    emotionCounts.set(emotion, (emotionCounts.get(emotion) ?? 0) + 1);

    const replyMode = normalizeMode(turn.replyMode);
    replyModeCounts.set(replyMode, (replyModeCounts.get(replyMode) ?? 0) + 1);

    const tone = String(turn.toneStyle ?? "calm");
    toneCounts.set(tone, (toneCounts.get(tone) ?? 0) + 1);
  }

  const dominantEmotion = [...emotionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? String(conversationState?.emotion ?? "neutral");
  const dominantReplyMode = [...replyModeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? normalizeMode(conversationState?.lastMode as string | null);
  const dominantTone = [...toneCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? String(conversationState?.lastToneStyle ?? "calm");

  const recurringTopics = Object.keys(user?.topicInterests ?? {})
    .slice(0, 5)
    .map((topic) => topic.replace(/_/g, " "));

  const recentMemoriesList = recentMemories
    .map((memory) => String(memory.value ?? memory.key ?? ""))
    .filter(Boolean)
    .slice(0, 5);

  const profile: ComputedUserProfile = {
    userId,
    bondTier: resolveBondTier(Number(user?.bondScore ?? 0.1)),
    bondScore: Number(user?.bondScore ?? 0.1),
    dominantEmotion,
    dominantReplyMode,
    dominantTone,
    activeArcs,
    recurringTopics,
    recentMemories: recentMemoriesList,
    observedPatterns: (user?.observedPatterns as string[]) ?? [],
    summary: [
      `Bond: ${resolveBondTier(Number(user?.bondScore ?? 0.1))} (${Number(user?.bondScore ?? 0.1).toFixed(2)})`,
      `Dominant emotion: ${dominantEmotion}`,
      `Preferred reply mode: ${dominantReplyMode}`,
      `Tone tendency: ${dominantTone}`,
      `Active life arcs: ${activeArcs}`,
      recurringTopics.length > 0 ? `Recurring topics: ${recurringTopics.join(", ")}` : null,
      recentMemoriesList.length > 0 ? `Recent memory themes: ${recentMemoriesList.join(" | ")}` : null,
    ].filter(Boolean).join(". "),
  };

  const promptLines: string[] = ["--- USER PROFILE BUILDER ---"];
  promptLines.push(`- Bond tier: ${profile.bondTier} (${profile.bondScore.toFixed(2)})`);
  promptLines.push(`- Dominant emotion trend: ${profile.dominantEmotion}`);
  promptLines.push(`- Reply style bias: ${profile.dominantReplyMode}`);
  promptLines.push(`- Tone bias: ${profile.dominantTone}`);
  promptLines.push(`- Active life arcs: ${profile.activeArcs}`);
  if (profile.observedPatterns.length > 0) {
    promptLines.push(`- Observed patterns: ${profile.observedPatterns.slice(0, 5).join(", ")}`);
  }
  if (profile.recurringTopics.length > 0) {
    promptLines.push(`- Recurring topics: ${profile.recurringTopics.slice(0, 5).join(", ")}`);
  }
  if (profile.recentMemories.length > 0) {
    promptLines.push(`- Recent memory themes: ${profile.recentMemories.slice(0, 5).join(" | ")}`);
  }
  promptLines.push("- Use this profile to sound more specific, less generic, and more personally aware.");

  return {
    profile,
    prompt: promptLines.join("\n"),
  };
}
