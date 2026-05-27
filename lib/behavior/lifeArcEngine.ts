import User from "@/lib/models/User";
import LifeArc from "@/lib/models/LifeArc";

interface LifeEventLike {
  event?: string;
  date?: Date | string | null;
  importance?: "low" | "medium" | "high" | "critical";
  context?: string;
  resolved?: boolean;
  nudgeCount?: number;
  lastNudgedAt?: Date | string | null;
}

export interface LifeArcSnapshot {
  arcKey: string;
  title: string;
  status: "seeded" | "active" | "building" | "closing" | "resolved";
  phase: "seed" | "develop" | "peak" | "resolve";
  importance: "low" | "medium" | "high" | "critical";
  targetDate: Date | null;
  mentionCount: number;
  promptCue: string;
}

export interface LifeArcResult {
  prompt: string;
  arcs: LifeArcSnapshot[];
  seededCount: number;
  activeCount: number;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function buildArcKey(event: LifeEventLike): string {
  const eventName = String(event.event ?? "life_event").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const date = toDate(event.date);
  const dateKey = date ? date.toISOString().slice(0, 10) : "open-ended";
  return `${eventName}:${dateKey}`;
}

function resolveStatus(event: LifeEventLike, existingStatus?: LifeArcSnapshot["status"]): LifeArcSnapshot["status"] {
  if (existingStatus === "resolved" && !event.resolved) {
    return "active";
  }

  const date = toDate(event.date);
  if (!date) return existingStatus || "seeded";

  const days = daysUntil(date);
  if (days === null) return existingStatus || "seeded";
  if (days < -3 || event.resolved) return "resolved";
  if (days <= 1) return "closing";
  if (days <= 7) return "building";
  if (days <= 21) return "active";
  return existingStatus || "seeded";
}

function resolvePhase(status: LifeArcSnapshot["status"]): LifeArcSnapshot["phase"] {
  switch (status) {
    case "building":
      return "develop";
    case "closing":
      return "peak";
    case "resolved":
      return "resolve";
    case "active":
    default:
      return "seed";
  }
}

function buildPromptCue(arc: LifeArcSnapshot): string {
  const days = daysUntil(arc.targetDate);
  if (arc.status === "resolved") {
    return `This arc is resolved. Reference it only as a past thread if the user brings it up.`;
  }
  if (days === null) {
    return `Keep this thread alive gently. It is an open-ended life theme.`;
  }
  if (days <= 1) {
    return `This is immediate. Stay grounded and specific if the user mentions it.`;
  }
  if (days <= 7) {
    return `This is active. Thread it naturally into the conversation.`;
  }
  return `This is a slow-burning arc. Keep it in the background and remember the long game.`;
}

async function seedFromLifeEvents(userId: string, events: LifeEventLike[]): Promise<LifeArcSnapshot[]> {
  const snapshots: LifeArcSnapshot[] = [];

  for (const event of events) {
    if (!event.event || event.resolved) continue;

    const arcKey = buildArcKey(event);
    const existing = await LifeArc.findOne({ userId, arcKey }).lean();
    const status = resolveStatus(event, existing?.status as LifeArcSnapshot["status"] | undefined);
    const phase = resolvePhase(status);
    const targetDate = toDate(event.date);
    const importance = event.importance ?? "medium";

    const promptBase = {
      arcKey,
      title: event.event,
      sourceEvent: {
        event: event.event,
        date: targetDate,
        importance,
        context: event.context ?? "",
      },
      status,
      phase,
      importance,
      startDate: existing?.startDate ?? Date.now(),
      targetDate,
      lastMentionedAt: new Date(),
      mentionCount: Number(existing?.mentionCount ?? 0) + 1,
      resolvedAt: status === "resolved" ? new Date() : null,
      notes: existing?.notes ?? [],
      promptCue: "",
    };

    const upserted = await LifeArc.findOneAndUpdate(
      { userId, arcKey },
      { $set: { ...promptBase, promptCue: "" } },
      { upsert: true, returnDocument: 'after' },
    );

    const snapshot: LifeArcSnapshot = {
      arcKey,
      title: event.event,
      status,
      phase,
      importance,
      targetDate,
      mentionCount: Number(upserted?.mentionCount ?? 0),
      promptCue: buildPromptCue({
        arcKey,
        title: event.event,
        status,
        phase,
        importance,
        targetDate,
        mentionCount: Number(upserted?.mentionCount ?? 0),
        promptCue: "",
      }),
    };

    await LifeArc.updateOne(
      { userId, arcKey },
      { $set: { promptCue: snapshot.promptCue } },
    );

    snapshots.push(snapshot);
  }

  return snapshots;
}

export async function buildLifeArcPrompt(userId: string, input: string): Promise<LifeArcResult> {
  const user = await User.findOne({ userId }).lean();
  const events = (user?.lifeEvents as LifeEventLike[] | undefined) ?? [];
  const activeEvents = events.filter((event) => event && !event.resolved && event.event);

  const snapshots = await seedFromLifeEvents(userId, activeEvents);
  const persisted = await LifeArc.find({ userId })
    .sort({ status: 1, lastMentionedAt: -1 })
    .limit(8)
    .lean();

  const activeCount = persisted.filter((arc) => arc.status !== "resolved").length;
  const seededCount = snapshots.length;

  if (persisted.length === 0) {
    return {
      prompt: "",
      arcs: [],
      seededCount,
      activeCount,
    };
  }

  const lines: string[] = ["--- LIFE ARC ENGINE ---"];
  lines.push("- Treat active life events as ongoing narrative threads, not one-off facts.");
  lines.push("- When a life arc is active, reference progress, continuity, and next steps naturally.");
  lines.push("- If an arc is resolved, only mention it when the user reopens it.");

  for (const arc of persisted) {
    lines.push(
      `- ARC [${String(arc.title ?? arc.arcKey)}]: status=${arc.status}, phase=${arc.phase}, importance=${arc.importance}, target=${arc.targetDate ? new Date(arc.targetDate).toISOString().slice(0, 10) : "none"}`,
    );
    if (arc.promptCue) {
      lines.push(`  * ${arc.promptCue}`);
    }
  }

  return {
    prompt: lines.join("\n"),
    arcs: persisted.map((arc) => ({
      arcKey: String(arc.arcKey),
      title: String(arc.title ?? arc.arcKey),
      status: arc.status,
      phase: arc.phase,
      importance: arc.importance,
      targetDate: arc.targetDate ? new Date(arc.targetDate) : null,
      mentionCount: Number(arc.mentionCount ?? 0),
      promptCue: String(arc.promptCue ?? ""),
    })),
    seededCount,
    activeCount,
  };
}
