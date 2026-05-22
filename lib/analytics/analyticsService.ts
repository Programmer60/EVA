import TurnAnalytics from "@/lib/models/TurnAnalytics";
import LifeArc from "@/lib/models/LifeArc";
import Memory from "@/lib/models/Memory";
import User from "@/lib/models/User";
import { connectDB } from "@/lib/mongodb";

type TurnDoc = {
  userId?: string;
  timestamp?: Date | string;
  replyMode?: string;
  replyEmotion?: string;
  userEmotion?: string;
  bondScore?: number;
  responseTimeMs?: number;
  replyLength?: number;
  memoriesRetrieved?: number;
  memoryKeysUsed?: string[];
};

type MemoryTrendItem = {
  key: string;
  value: string;
  accessCount: number;
  memoryMentionCount: number;
  lastAccessed: string | null;
};

type TrendPoint = {
  timestamp: string;
  value: number;
  label: string;
};

export type AnalyticsOverview = {
  scope: "global" | "user";
  userId?: string;
  totalTurns: number;
  uniqueUsers: number;
  avgResponseTimeMs: number;
  avgSessionLengthTurns: number;
  avgSessionLengthMinutes: number;
  avgReplyLength: number;
  avgMemoryUsed: number;
  memoryRetrievalCount: number;
  activeArcs: number;
  dominantEmotion: string;
  dominantReplyMode: string;
  dominantTone: string;
  latestUserId: string | null;
  recentTurns: Array<Record<string, unknown>>;
  bondTrend: TrendPoint[];
  emotionTrend: TrendPoint[];
  replyModeDistribution: Array<{ replyMode: string; count: number; percentage: number }>;
  mostRetrievedMemories: MemoryTrendItem[];
  topUsers: Array<{ userId: string; turns: number; avgResponseTimeMs: number }>;
};

function toIsoDate(value?: Date | string): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function buildSessionSummary(turns: TurnDoc[]): { avgTurns: number; avgMinutes: number } {
  if (turns.length === 0) {
    return { avgTurns: 0, avgMinutes: 0 };
  }

  const sessions: Array<{ turns: number; durationMs: number }> = [];
  let sessionStart = new Date(turns[0].timestamp ?? Date.now());
  let previousTurnAt = new Date(turns[0].timestamp ?? Date.now());
  let sessionTurns = 1;

  for (let index = 1; index < turns.length; index++) {
    const turn = turns[index];
    const turnAt = new Date(turn.timestamp ?? Date.now());
    const gapMs = turnAt.getTime() - previousTurnAt.getTime();

    if (gapMs > 30 * 60 * 1000) {
      sessions.push({
        turns: sessionTurns,
        durationMs: Math.max(previousTurnAt.getTime() - sessionStart.getTime(), 0),
      });
      sessionStart = turnAt;
      sessionTurns = 1;
    } else {
      sessionTurns += 1;
    }

    previousTurnAt = turnAt;
  }

  sessions.push({
    turns: sessionTurns,
    durationMs: Math.max(previousTurnAt.getTime() - sessionStart.getTime(), 0),
  });

  const totalTurns = sessions.reduce((sum, session) => sum + session.turns, 0);
  const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMs / 60_000, 0);

  return {
    avgTurns: sessions.length > 0 ? totalTurns / sessions.length : 0,
    avgMinutes: sessions.length > 0 ? totalMinutes / sessions.length : 0,
  };
}

function buildDistribution(turns: TurnDoc[]): Array<{ replyMode: string; count: number; percentage: number }> {
  if (turns.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const turn of turns) {
    const mode = String(turn.replyMode ?? "reaction");
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([replyMode, count]) => ({
      replyMode,
      count,
      percentage: Math.round((count / turns.length) * 100),
    }));
}

function buildTrend(turns: TurnDoc[], selector: (turn: TurnDoc) => number, labelSelector: (turn: TurnDoc) => string): TrendPoint[] {
  return turns.slice(-12).map((turn) => ({
    timestamp: toIsoDate(turn.timestamp),
    value: selector(turn),
    label: labelSelector(turn),
  }));
}

export async function getAnalyticsOverview(userId?: string, recentLimit = 8): Promise<AnalyticsOverview> {
  await connectDB();

  const match = userId ? { userId } : {};
  const [summary] = await TurnAnalytics.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalTurns: { $sum: 1 },
        uniqueUsersSet: { $addToSet: "$userId" },
        avgResponseTimeMs: { $avg: "$responseTimeMs" },
        avgReplyLength: { $avg: "$replyLength" },
        avgMemoryUsed: { $avg: "$memoriesRetrieved" },
      },
    },
  ]);

  const replyModes = await TurnAnalytics.aggregate([
    { $match: match },
    { $group: { _id: "$replyMode", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);

  const emotions = await TurnAnalytics.aggregate([
    { $match: match },
    { $group: { _id: "$replyEmotion", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);

  const tones = await TurnAnalytics.aggregate([
    { $match: match },
    { $group: { _id: "$toneStyle", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);

  const allTurns = (await TurnAnalytics.find(match)
    .sort({ timestamp: 1 })
    .select("userId timestamp replyMode replyEmotion userEmotion bondScore responseTimeMs replyLength memoriesRetrieved memoryKeysUsed")
    .lean()) as TurnDoc[];

  const sessionSummary = buildSessionSummary(allTurns);
  const replyModeDistribution = buildDistribution(allTurns);
  const memoryRetrievalCount = allTurns.reduce((sum, turn) => sum + Number(turn.memoriesRetrieved ?? 0), 0);
  const bondTrend = buildTrend(allTurns, (turn) => Number(turn.bondScore ?? 0), (turn) => String(turn.replyMode ?? "reaction"));
  const emotionTrend = buildTrend(allTurns, (turn) => Number(turn.bondScore ?? 0), (turn) => String(turn.replyEmotion ?? turn.userEmotion ?? "neutral"));

  const mostRetrievedMemories = (await Memory.find({
    ...match,
    deletedAt: null,
  })
    .sort({ accessCount: -1, memoryMentionCount: -1, lastAccessed: -1 })
    .limit(8)
    .lean()) as Array<Record<string, unknown>>;

  const topUsers = userId
    ? []
    : await TurnAnalytics.aggregate([
        {
          $group: {
            _id: "$userId",
            turns: { $sum: 1 },
            avgResponseTimeMs: { $avg: "$responseTimeMs" },
          },
        },
        { $sort: { turns: -1 } },
        { $limit: 5 },
      ]);

  const recentTurns = await TurnAnalytics.find(match)
    .sort({ timestamp: -1 })
    .limit(Math.max(recentLimit, 1))
    .lean();

  const latestUserId = recentTurns[0]?.userId ? String(recentTurns[0].userId) : userId ?? null;
  const activeArcs = await LifeArc.countDocuments(userId ? { userId, status: { $ne: "resolved" } } : { status: { $ne: "resolved" } });
  const latestUser = latestUserId ? await User.findOne({ userId: latestUserId }).lean() : null;

  return {
    scope: userId ? "user" : "global",
    userId,
    totalTurns: Number(summary?.totalTurns ?? 0),
    uniqueUsers: userId ? 1 : Number(summary?.uniqueUsersSet?.length ?? 0),
    avgResponseTimeMs: Number(summary?.avgResponseTimeMs ?? 0),
    avgSessionLengthTurns: sessionSummary.avgTurns,
    avgSessionLengthMinutes: sessionSummary.avgMinutes,
    avgReplyLength: Number(summary?.avgReplyLength ?? 0),
    avgMemoryUsed: Number(summary?.avgMemoryUsed ?? 0),
    memoryRetrievalCount,
    activeArcs,
    dominantEmotion: String(emotions[0]?._id ?? latestUser?.moodState ?? "neutral"),
    dominantReplyMode: String(replyModes[0]?._id ?? "reaction"),
    dominantTone: String(tones[0]?._id ?? "calm"),
    latestUserId,
    recentTurns: recentTurns.map((turn) => ({
      ...turn,
      timestamp: turn.timestamp ? new Date(turn.timestamp as string).toISOString() : null,
    })),
    bondTrend,
    emotionTrend,
    replyModeDistribution,
    mostRetrievedMemories: mostRetrievedMemories.map((memory) => ({
      key: String(memory.key ?? ""),
      value: String(memory.value ?? ""),
      accessCount: Number(memory.accessCount ?? 0),
      memoryMentionCount: Number(memory.memoryMentionCount ?? 0),
      lastAccessed: memory.lastAccessed ? toIsoDate(memory.lastAccessed as Date | string) : null,
    })),
    topUsers: topUsers.map((entry) => ({
      userId: String(entry._id ?? "anonymous"),
      turns: Number(entry.turns ?? 0),
      avgResponseTimeMs: Number(entry.avgResponseTimeMs ?? 0),
    })),
  };
}
