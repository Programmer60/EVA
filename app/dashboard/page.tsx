import { getAnalyticsOverview } from "@/lib/analytics/analyticsService";
import { buildUserProfile } from "@/lib/profile/profileBuilder";

export default async function DashboardPage() {
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
  let profile: Awaited<ReturnType<typeof buildUserProfile>>["profile"] = null;

  try {
    analytics = await getAnalyticsOverview(undefined, 12);
    const latestProfile = analytics.latestUserId ? await buildUserProfile(analytics.latestUserId) : { profile: null, prompt: "" };
    profile = latestProfile.profile;
  } catch {
    // render fallback dashboard when data is unavailable
  }

  return (
    <main className="eva-page eva-dashboard-page">
      <header className="eva-hero">
        <p className="eva-kicker">Analytics Console</p>
        <h1>Dashboard</h1>
        <p className="eva-subtitle">
          Companion intelligence snapshot: turn behavior, bond trajectory, active arcs, and conversation quality.
        </p>
      </header>

      <section className="eva-dashboard-grid">
        <article className="eva-card eva-metric-card">
          <h2>Total Turns</h2>
          <strong>{analytics.totalTurns}</strong>
          <span>Across {analytics.uniqueUsers} user(s)</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Avg Response Time</h2>
          <strong>{Math.round(analytics.avgResponseTimeMs)} ms</strong>
          <span>Based on recent turns</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Average Session Length</h2>
          <strong>{analytics.avgSessionLengthTurns.toFixed(1)} turns</strong>
          <span>{analytics.avgSessionLengthMinutes.toFixed(1)} minutes on average</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Memory Retrieval Count</h2>
          <strong>{analytics.memoryRetrievalCount}</strong>
          <span>Total retrieved memories</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Active Arcs</h2>
          <strong>{analytics.activeArcs}</strong>
          <span>Narrative threads in motion</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>Dominant Reply Mode</h2>
          <strong>{analytics.dominantReplyMode}</strong>
          <span>Recent behavioral bias</span>
        </article>
      </section>

      <section className="eva-grid eva-dashboard-stack">
        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Latest User Profile</h2>
            <span className="eva-pill">Computed</span>
          </div>
          {profile ? (
            <div className="eva-profile-panel">
              <p className="eva-note">{profile.summary}</p>
              <ul className="eva-list">
                <li>Bond tier: {profile.bondTier}</li>
                <li>Dominant emotion: {profile.dominantEmotion}</li>
                <li>Preferred reply mode: {profile.dominantReplyMode}</li>
                <li>Tone tendency: {profile.dominantTone}</li>
                <li>Active arcs: {profile.activeArcs}</li>
              </ul>
            </div>
          ) : (
            <p className="eva-note">No profile data yet. Start a conversation to populate the dashboard.</p>
          )}
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Recent Turns</h2>
            <span className="eva-pill">{analytics.recentTurns.length}</span>
          </div>
          <div className="eva-table-wrap">
            <table className="eva-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Emotion</th>
                  <th>Reply Mode</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentTurns.map((turn, index) => (
                  <tr key={`${String(turn.userId ?? "user")}-${index}`}>
                    <td>{String(turn.userId ?? "anonymous")}</td>
                    <td>{String(turn.replyEmotion ?? turn.userEmotion ?? "neutral")}</td>
                    <td>{String(turn.replyMode ?? "reaction")}</td>
                    <td>{String(turn.responseTimeMs ?? 0)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Reply Mode Distribution</h2>
            <span className="eva-pill">Behavior mix</span>
          </div>
          <ul className="eva-list">
            {analytics.replyModeDistribution.length > 0 ? (
              analytics.replyModeDistribution.map((item) => (
                <li key={item.replyMode}>
                  {item.replyMode}: {item.count} turns ({item.percentage}%)
                </li>
              ))
            ) : (
              <li>No reply mode data yet.</li>
            )}
          </ul>
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Bond Trend</h2>
            <span className="eva-pill">Recent turns</span>
          </div>
          <ul className="eva-list">
            {analytics.bondTrend.length > 0 ? (
              analytics.bondTrend.map((point) => (
                <li key={point.timestamp}>
                  {new Date(point.timestamp).toLocaleDateString()}: {point.value.toFixed(2)} ({point.label})
                </li>
              ))
            ) : (
              <li>No bond trend data yet.</li>
            )}
          </ul>
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Emotion Trend</h2>
            <span className="eva-pill">Recent turns</span>
          </div>
          <ul className="eva-list">
            {analytics.emotionTrend.length > 0 ? (
              analytics.emotionTrend.map((point) => (
                <li key={point.timestamp}>
                  {new Date(point.timestamp).toLocaleDateString()}: {point.label}
                </li>
              ))
            ) : (
              <li>No emotion trend data yet.</li>
            )}
          </ul>
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Most Retrieved Memories</h2>
            <span className="eva-pill">Top memory facts</span>
          </div>
          <ul className="eva-list">
            {analytics.mostRetrievedMemories.length > 0 ? (
              analytics.mostRetrievedMemories.map((memory) => (
                <li key={memory.key}>
                  {memory.key}: {memory.value} ({memory.accessCount} accesses)
                </li>
              ))
            ) : (
              <li>No retrieval data yet.</li>
            )}
          </ul>
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Top Users</h2>
            <span className="eva-pill">Ranked</span>
          </div>
          <ul className="eva-list">
            {analytics.topUsers.length > 0 ? (
              analytics.topUsers.map((item) => (
                <li key={item.userId}>
                  {item.userId}: {item.turns} turns, avg {Math.round(item.avgResponseTimeMs)} ms
                </li>
              ))
            ) : (
              <li>No global ranking data yet.</li>
            )}
          </ul>
        </section>
      </section>
    </main>
  );
}
