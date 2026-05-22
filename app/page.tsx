import { AvatarPanel } from "@/components/avatar/AvatarPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { getAnalyticsOverview } from "@/lib/analytics/analyticsService";
import { buildUserProfile } from "@/lib/profile/profileBuilder";

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

  return (
    <main className="eva-page">
      <header className="eva-hero">
        <p className="eva-kicker">Emotionally Aware Virtual Assistant</p>
        <h1>EVA</h1>
        <p className="eva-subtitle">
          Next.js-first foundation is live. Phase 0 is now ready for conversation,
          memory, emotion, and voice integration.
        </p>
      </header>

      <section className="eva-dashboard-grid eva-quick-debug">
        <article className="eva-card eva-metric-card">
          <h2>Bond</h2>
          <strong>{profile?.bondTier ?? "new"}</strong>
          <span>{profile ? `Score ${profile.bondScore.toFixed(2)}` : "Waiting for conversation data"}</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Mood</h2>
          <strong>{profile?.dominantEmotion ?? analytics.dominantEmotion}</strong>
          <span>Latest emotional baseline</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Active Arcs</h2>
          <strong>{profile?.activeArcs ?? analytics.activeArcs}</strong>
          <span>Narrative threads in motion</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Recent Mode</h2>
          <strong>{profile?.dominantReplyMode ?? analytics.dominantReplyMode}</strong>
          <span>Behavioral bias</span>
        </article>
      </section>

      <section className="eva-grid">
        <AvatarPanel />
        <ChatPanel />
        <VoicePanel />
        <section className="eva-card">
          <div className="eva-section-header">
            <h2>System Status</h2>
            <span className="eva-pill">Phase 5</span>
          </div>
          <ul className="eva-list">
            <li>Next.js App Router: active</li>
            <li>API health endpoint: active</li>
            <li>Chat route scaffold: active</li>
            <li>Environment strategy: active</li>
            <li>Error handling and logger: active</li>
            <li>Avatar expression system: active</li>
          </ul>
        </section>
      </section>

      <section className="eva-architecture">
        <h2>High-level Flow</h2>
        <p>
          User -{">"} Frontend -{">"} STT -{">"} Conversation Engine -{">"}{" "}
          Emotion + Memory -{">"} TTS -{">"} Avatar
        </p>
      </section>
    </main>
  );
}
