import { AvatarPanel } from "@/components/avatar/AvatarPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { getAnalyticsOverview } from "@/lib/analytics/analyticsService";
import { buildUserProfile } from "@/lib/profile/profileBuilder";
import DashboardClient from "@/components/DashboardClient";

export default async function Home() {
  let analytics: Awaited<ReturnType<typeof getAnalyticsOverview>> = {
    scope: "global",
    totalTurns: 0,
    uniqueUsers: 0,
    avgResponseTimeMs: 0,
    avgSessionLengthTurns: 0,
    avgSessionLengthMinutes: 0,
    avgReplyLength: 0,
    avgMemoryUsed: 0,
    memoryRetrievalCount: 0,
    activeArcs: 0,
    dominantEmotion: "neutral",
    dominantReplyMode: "reaction",
    dominantTone: "calm",
    latestUserId: null,
    recentTurns: [],
    bondTrend: [],
    emotionTrend: [],
    replyModeDistribution: [],
    mostRetrievedMemories: [],
    topUsers: [],
  };
  let profile: {
    bondTier: "new" | "warming" | "comfortable" | "close";
    bondScore: number;
    dominantEmotion: string;
    dominantReplyMode: string;
    activeArcs: number;
  } | null = null;

  try {
    analytics = await getAnalyticsOverview(undefined, 4);
    const latestProfile = analytics.latestUserId ? await buildUserProfile(analytics.latestUserId) : { profile: null, prompt: "" };
    profile = latestProfile.profile;
  } catch {
    // keep fallback cards visible even if analytics storage is unavailable
  }

    const safeAnalytics = JSON.parse(JSON.stringify(analytics));
    const safeProfile = profile ? JSON.parse(JSON.stringify(profile)) : null;

  return (
    <DashboardClient profile={safeProfile} analytics={safeAnalytics} />
  );
}
