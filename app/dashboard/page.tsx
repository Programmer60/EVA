import { getAnalyticsOverview } from "@/lib/analytics/analyticsService";
import { buildUserProfile } from "@/lib/profile/profileBuilder";
import Link from "next/link";
import { ArrowLeft, Activity, Clock, Database, Brain, Sparkles, MessageCircle } from "lucide-react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const { userId } = await auth();
  const adminId = process.env.ADMIN_USER_ID;
  
  if (!userId || !adminId || userId !== adminId) {
    redirect("/");
  }

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
    <main className="min-h-screen bg-background text-foreground flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px] bg-primary/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-10 flex-1 flex flex-col space-y-10">
        
        {/* Header */}
        <header className="flex flex-col space-y-3">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors mb-2 group w-fit"
          >
            <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
            Back to Home
          </Link>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-1">Analytics Console</p>
              <h1 className="text-4xl font-serif tracking-tight">Intelligence Dashboard</h1>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
                Companion intelligence snapshot: turn behavior, bond trajectory, active arcs, and conversation quality.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-xs font-medium border border-primary/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Live Tracking
            </div>
          </div>
        </header>

        {/* Top Metrics Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard 
            title="Total Turns" 
            value={analytics.totalTurns.toString()} 
            subtitle={`Across ${analytics.uniqueUsers} user(s)`}
            icon={<MessageCircle className="w-5 h-5 text-primary/70" />}
          />
          <MetricCard 
            title="Avg Response Time" 
            value={`${Math.round(analytics.avgResponseTimeMs)} ms`} 
            subtitle="Based on recent turns"
            icon={<Activity className="w-5 h-5 text-emerald-500/70" />}
          />
          <MetricCard 
            title="Average Session" 
            value={`${analytics.avgSessionLengthTurns.toFixed(1)} turns`} 
            subtitle={`${analytics.avgSessionLengthMinutes.toFixed(1)} min on average`}
            icon={<Clock className="w-5 h-5 text-blue-500/70" />}
          />
          <MetricCard 
            title="Memory Retrievals" 
            value={analytics.memoryRetrievalCount.toString()} 
            subtitle="Total retrieved memories"
            icon={<Database className="w-5 h-5 text-purple-500/70" />}
          />
          <MetricCard 
            title="Active Arcs" 
            value={analytics.activeArcs.toString()} 
            subtitle="Narrative threads in motion"
            icon={<Sparkles className="w-5 h-5 text-amber-500/70" />}
          />
          <MetricCard 
            title="Dominant Reply Mode" 
            value={analytics.dominantReplyMode.replace("_", " ")} 
            subtitle="Recent behavioral bias"
            icon={<Brain className="w-5 h-5 text-rose-500/70" />}
          />
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* Main Column (Tables & Lists) */}
          <div className="xl:col-span-2 space-y-6">
            <DashboardPanel title="Latest User Profile" badge="Computed">
              {profile ? (
                <div className="space-y-4">
                  <p className="text-sm text-foreground/80 leading-relaxed bg-muted/30 p-4 rounded-xl border border-border/40">
                    {profile.summary}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <ProfileBadge label="Bond Tier" value={profile.bondTier} />
                    <ProfileBadge label="Emotion" value={profile.dominantEmotion} />
                    <ProfileBadge label="Reply Mode" value={profile.dominantReplyMode} />
                    <ProfileBadge label="Tone" value={profile.dominantTone} />
                    <ProfileBadge label="Active Arcs" value={profile.activeArcs.toString()} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No profile data yet. Start a conversation to populate the dashboard.</p>
              )}
            </DashboardPanel>

            <DashboardPanel title="Recent Turns" badge={analytics.recentTurns.length.toString()}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground uppercase bg-muted/20 border-b border-border/40">
                    <tr>
                      <th className="px-4 py-3 font-medium rounded-tl-xl">User</th>
                      <th className="px-4 py-3 font-medium">Emotion</th>
                      <th className="px-4 py-3 font-medium">Reply Mode</th>
                      <th className="px-4 py-3 font-medium rounded-tr-xl">Response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {analytics.recentTurns.map((turn, index) => (
                      <tr key={`${String(turn.userId ?? "user")}-${index}`} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3 text-foreground/80 truncate max-w-[150px]" title={String(turn.userId ?? "anonymous")}>
                          {String(turn.userId ?? "anonymous")}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary/50 text-secondary-foreground">
                            {String(turn.replyEmotion ?? turn.userEmotion ?? "neutral")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground/70">{String(turn.replyMode ?? "reaction").replace("_", " ")}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{String(turn.responseTimeMs ?? 0)} ms</td>
                      </tr>
                    ))}
                    {analytics.recentTurns.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm italic">
                          No recent turns recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </DashboardPanel>
            
            <DashboardPanel title="Most Retrieved Memories" badge="Top facts">
              <div className="space-y-3">
                {analytics.mostRetrievedMemories.length > 0 ? (
                  analytics.mostRetrievedMemories.map((memory, i) => (
                    <div key={`${memory.key}-${i}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-border/40 bg-muted/10">
                      <div className="flex items-start flex-col gap-1 overflow-hidden">
                        <span className="text-xs font-mono text-primary truncate max-w-full">{memory.key}</span>
                        <span className="text-sm text-foreground/90 line-clamp-1">{memory.value}</span>
                      </div>
                      <div className="flex-shrink-0 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded-md">
                        {memory.accessCount} accesses
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic px-2">No retrieval data yet.</p>
                )}
              </div>
            </DashboardPanel>
          </div>

          {/* Side Column (Stats & Trends) */}
          <div className="space-y-6">
            <DashboardPanel title="Reply Mode Distribution">
              <div className="space-y-3 mt-2">
                {analytics.replyModeDistribution.length > 0 ? (
                  analytics.replyModeDistribution.map((item) => (
                    <div key={item.replyMode} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-foreground/80">{item.replyMode.replace("_", " ")}</span>
                        <span className="text-muted-foreground">{item.count} ({item.percentage}%)</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary/60 rounded-full" 
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic">No reply mode data yet.</p>
                )}
              </div>
            </DashboardPanel>

            <DashboardPanel title="Bond Trend">
              <div className="space-y-3">
                {analytics.bondTrend.length > 0 ? (
                  analytics.bondTrend.map((point) => (
                    <div key={point.timestamp} className="flex justify-between items-center text-sm border-b border-border/20 pb-2 last:border-0 last:pb-0">
                      <span className="text-muted-foreground text-xs">{new Date(point.timestamp).toLocaleDateString()}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-foreground/90 font-medium">{point.value.toFixed(2)}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/40 text-secondary-foreground">{point.label}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic">No bond trend data yet.</p>
                )}
              </div>
            </DashboardPanel>

            <DashboardPanel title="Top Users">
              <div className="space-y-3">
                {analytics.topUsers.length > 0 ? (
                  analytics.topUsers.map((item, i) => (
                    <div key={item.userId} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {i + 1}
                        </div>
                        <span className="text-sm text-foreground/80 truncate">{item.userId}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-sm font-medium">{item.turns} turns</div>
                        <div className="text-xs text-muted-foreground">{Math.round(item.avgResponseTimeMs)}ms avg</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic px-2">No global ranking data yet.</p>
                )}
              </div>
            </DashboardPanel>
          </div>

        </div>
      </div>
    </main>
  );
}

// Subcomponents for cleaner code

function MetricCard({ title, value, subtitle, icon }: { title: string, value: string, subtitle: string, icon: React.ReactNode }) {
  return (
    <div className="bg-card/40 backdrop-blur-md border border-border/40 p-5 rounded-2xl flex flex-col justify-between hover:bg-card/60 transition-colors shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className="p-2 bg-muted/40 rounded-lg">{icon}</div>
      </div>
      <div>
        <p className="text-2xl font-semibold text-foreground tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

function DashboardPanel({ title, badge, children }: { title: string, badge?: string, children: React.ReactNode }) {
  return (
    <div className="bg-card/40 backdrop-blur-md border border-border/40 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-border/40 bg-muted/10 flex justify-between items-center">
        <h2 className="font-medium text-foreground">{title}</h2>
        {badge && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2.5 py-0.5 rounded-full border border-primary/20">
            {badge}
          </span>
        )}
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  );
}

function ProfileBadge({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/30 bg-muted/10">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <span className="text-sm font-medium text-foreground/90 capitalize truncate">{value.replace("_", " ")}</span>
    </div>
  );
}
