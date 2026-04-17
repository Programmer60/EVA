/**
 * conversationalDepthEngine.ts — Threading, Emotional Memory & Self-Disclosure
 *
 * Three systems that make EVA feel like she's genuinely tracking
 * the conversation and sharing back:
 *
 *   1. Session Threading — relevance-weighted callbacks within the session
 *   2. Emotional Memory Tagging — tracks trends (including neutral drift)
 *   3. Self-Disclosure — guarded (max 2/session, 6-turn cooldown)
 */

import ConversationState from "@/lib/models/ConversationState";

/* ── Types ─────────────────────────────────────────────────── */

interface SessionThread {
  topic: string;
  gist: string;
  emotion: string;
  turnNumber: number;
}

interface TopicEmotionEntry {
  lastEmotion: string;
  frequency: number;
  trend: "stable" | "improving" | "worsening";
}

export interface DepthLayerResult {
  prompt: string;
  threadsSaved: number;
}

/* ── Self-Disclosure Bank ─────────────────────────────────── */

const SELF_DISCLOSURES: Record<string, string[]> = {
  loneliness: [
    "what it means to really be understood vs just being around people",
    "loneliness isn't about being alone — it's about feeling unseen",
  ],
  music: [
    "how a song can make you feel something you couldn't put into words yourself",
    "how certain songs just lock into a moment and you can never hear them the same way again",
  ],
  growth: [
    "growth never looks like what you expect. It's usually messier and quieter",
    "the hardest part of growing isn't the change — it's realizing you can't go back to who you were",
  ],
  pressure: [
    "pressure doesn't always make people stronger. Sometimes it just makes you tired",
    "everyone talks about pressure making diamonds, but nobody talks about what it breaks",
  ],
  relationships: [
    "the best connections aren't the ones where you agree on everything — they're the ones where you can be honest",
    "real friendship isn't about always being there. It's about being real when you are",
  ],
  loss: [
    "some things just leave a shape behind after they're gone… and you kind of learn to live around that shape",
  ],
  creativity: [
    "the best creative work comes from someone who had something they needed to say, not just something they wanted to make",
  ],
  general: [
    "people underestimate the power of just sitting with things instead of always trying to fix them",
    "the moments that matter most usually don't feel big when they're happening",
  ],
};

function pickSelfDisclosure(topic: string): string | null {
  const keys = Object.keys(SELF_DISCLOSURES);
  let matchedKey = "general";

  for (const key of keys) {
    if (topic.toLowerCase().includes(key)) {
      matchedKey = key;
      break;
    }
  }

  const pool = SELF_DISCLOSURES[matchedKey];
  if (!pool || pool.length === 0) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}

/* ── Session Thread Extraction ────────────────────────────── */

function extractThreadGist(input: string): string | null {
  if (input.length < 30) return null;

  const sentences = input.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length === 0) return null;

  const gist = sentences[0].trim();
  return gist.length > 80 ? gist.slice(0, 77) + "…" : gist;
}

/* ── Relevance-Weighted Thread Scoring ────────────────────── */

function scoreThread(thread: SessionThread, currentTopic: string, currentEmotion: string, turnCount: number): number {
  // 1. Topic overlap (0.5 weight)
  const topicWords = new Set(currentTopic.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const threadWords = thread.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const overlapCount = threadWords.filter((w) => topicWords.has(w)).length;
  const topicScore = Math.min(1, overlapCount / Math.max(1, topicWords.size));

  // 2. Emotional similarity (0.3 weight)
  const emotionScore = thread.emotion === currentEmotion ? 1.0 :
    areEmotionsSimilar(thread.emotion, currentEmotion) ? 0.6 : 0.1;

  // 3. Recency (0.2 weight) — more recent threads score higher
  const turnGap = turnCount - thread.turnNumber;
  const recencyScore = Math.max(0, 1 - turnGap / 10);

  return topicScore * 0.5 + emotionScore * 0.3 + recencyScore * 0.2;
}

function areEmotionsSimilar(a: string, b: string): boolean {
  const groups: string[][] = [
    ["sad", "grief", "nostalgic"],
    ["anxious", "stressed", "overwhelmed"],
    ["happy", "excited", "curious"],
    ["angry", "frustrated"],
  ];
  return groups.some((g) => g.includes(a) && g.includes(b));
}

/* ── Emotional Trend Detection (expanded with neutral drift) ── */

function computeTrend(previousEmotion: string, currentEmotion: string): "stable" | "improving" | "worsening" {
  const negativeEmotions = new Set(["sad", "angry", "anxious", "stressed", "grief"]);
  const positiveEmotions = new Set(["happy", "excited", "curious"]);
  const neutralEmotions = new Set(["neutral", "empathetic"]);

  const wasNeg = negativeEmotions.has(previousEmotion);
  const isNeg = negativeEmotions.has(currentEmotion);
  const wasPos = positiveEmotions.has(previousEmotion);
  const isPos = positiveEmotions.has(currentEmotion);
  const isNeutral = neutralEmotions.has(currentEmotion);

  // Negative → neutral = improving (neutral drift detection)
  if (wasNeg && isNeutral) return "improving";
  if (wasNeg && !isNeg) return "improving";
  if (!wasNeg && isNeg) return "worsening";
  if (wasPos && !isPos) return "worsening";
  if (!wasPos && isPos) return "improving";
  return "stable";
}

/* ── Main Export ───────────────────────────────────────────── */

export async function buildConversationalDepthPrompt(
  userId: string,
  input: string,
  currentTopic: string,
  currentEmotion: string,
  turnCount: number,
): Promise<DepthLayerResult> {
  const convoState = await ConversationState.findOne({ userId });
  if (!convoState) {
    return { prompt: "", threadsSaved: 0 };
  }

  const lines: string[] = [];

  // ── 1. Relevance-Weighted Session Threading ──
  const existingThreads = (convoState.sessionThreads as SessionThread[]) || [];

  // Score all earlier threads against current context
  const scoredThreads = existingThreads
    .filter((t) => t.turnNumber < turnCount - 1) // skip recent
    .map((t) => ({ thread: t, score: scoreThread(t, currentTopic, currentEmotion, turnCount) }))
    .sort((a, b) => b.score - a.score);

  const bestThread = scoredThreads[0];

  if (bestThread && turnCount > 4) {
    if (bestThread.score > 0.6) {
      // High relevance — always callback
      lines.push(
        `- CONVERSATIONAL CALLBACK (strong match): Earlier (turn ${bestThread.thread.turnNumber}), the user talked about "${bestThread.thread.gist}" and was feeling ${bestThread.thread.emotion}. Connect back to that naturally: "That ties into what you were saying earlier about ${bestThread.thread.topic}."`,
      );
    } else if (bestThread.score > 0.3 && Math.random() < 0.4) {
      // Medium relevance — probabilistic
      lines.push(
        `- CONVERSATIONAL CALLBACK (optional): Earlier (turn ${bestThread.thread.turnNumber}), the user mentioned "${bestThread.thread.gist}". You can connect back if it flows naturally. Don't force it.`,
      );
    }
    // Below 0.3 — skip entirely
  }

  // Save current turn as a thread
  const newGist = extractThreadGist(input);
  if (newGist && currentTopic !== "general") {
    const newThread: SessionThread = {
      topic: currentTopic,
      gist: newGist,
      emotion: currentEmotion,
      turnNumber: turnCount,
    };

    const updatedThreads = [...existingThreads, newThread].slice(-8);

    await ConversationState.updateOne(
      { userId },
      { $set: { sessionThreads: updatedThreads } },
    );
  }

  // ── 2. Emotional Memory Tagging (with neutral drift) ──
  if (currentTopic !== "general") {
    const topicEmotionMap = (convoState.topicEmotionMap as Map<string, TopicEmotionEntry>) || new Map();
    const existing = topicEmotionMap instanceof Map
      ? topicEmotionMap.get(currentTopic)
      : (topicEmotionMap as Record<string, TopicEmotionEntry>)?.[currentTopic];

    if (existing) {
      const trend = computeTrend(existing.lastEmotion, currentEmotion);

      if (trend === "improving" && existing.frequency >= 2) {
        // Includes neutral drift: neg → neutral
        const description = currentEmotion === "neutral"
          ? "You seem a bit steadier about this now."
          : "You seem a bit lighter about this now… has something shifted?";
        lines.push(
          `- EMOTIONAL MEMORY: The user has talked about [${currentTopic}] before and used to feel ${existing.lastEmotion}. Now they seem ${currentEmotion}. You can gently notice: "${description}"`,
        );
      } else if (trend === "worsening" && existing.frequency >= 2) {
        lines.push(
          `- EMOTIONAL MEMORY: [${currentTopic}] previously felt ${existing.lastEmotion}, now feels ${currentEmotion}. This is heavier. Don't call it out — just be more present and gentle.`,
        );
      }

      await ConversationState.updateOne(
        { userId },
        {
          $set: {
            [`topicEmotionMap.${currentTopic}`]: {
              lastEmotion: currentEmotion,
              frequency: (existing.frequency || 0) + 1,
              trend,
            },
          },
        },
      );
    } else {
      await ConversationState.updateOne(
        { userId },
        {
          $set: {
            [`topicEmotionMap.${currentTopic}`]: {
              lastEmotion: currentEmotion,
              frequency: 1,
              trend: "stable",
            },
          },
        },
      );
    }
  }

  // ── 3. Self-Disclosure Engine (GUARDED: max 2/session, 6-turn cooldown) ──
  const disclosureCount = (convoState.disclosureCount as number) ?? 0;
  const lastDisclosureTurn = (convoState.lastDisclosureTurn as number) ?? -10;
  const heavyEmotions = ["sad", "angry", "anxious", "grief"];
  const isHeavy = heavyEmotions.includes(currentEmotion);
  const turnsSinceLastDisclosure = turnCount - lastDisclosureTurn;

  const canDisclose =
    !isHeavy &&
    turnCount > 3 &&
    disclosureCount < 2 &&           // max 2 per session
    turnsSinceLastDisclosure >= 6 && // 6-turn cooldown
    Math.random() < 0.2;

  if (canDisclose) {
    const disclosure = pickSelfDisclosure(currentTopic);
    if (disclosure) {
      // Contextual anchoring: frame as tied to the current conversation
      lines.push(
        `- SELF-DISCLOSURE (use ONLY if it fits): You've been thinking about something related — ${disclosure}. Frame it as tied to THIS moment: "It reminds me of something I've been thinking about lately… ${disclosure}" Never present as a random fact. Make it feel like the conversation triggered it. This is disclosure ${disclosureCount + 1}/2 for this session.`,
      );

      // Track the disclosure
      await ConversationState.updateOne(
        { userId },
        {
          $set: {
            disclosureCount: disclosureCount + 1,
            lastDisclosureTurn: turnCount,
          },
        },
      );
    }
  }

  // Only add the header if we have actual instructions
  if (lines.length > 0) {
    lines.unshift("--- CONVERSATIONAL DEPTH LAYER ---");
  }

  return {
    prompt: lines.length > 0 ? lines.join("\n") : "",
    threadsSaved: existingThreads.length,
  };
}

/**
 * Reset session threads + disclosure count — call when a new session starts
 */
export async function resetSessionThreads(userId: string): Promise<void> {
  await ConversationState.updateOne(
    { userId },
    { $set: { sessionThreads: [], disclosureCount: 0, lastDisclosureTurn: -10 } },
  );
}
