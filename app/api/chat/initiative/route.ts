import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import Memory from "@/lib/models/Memory";
import InitiativeLog from "@/lib/models/InitiativeLog";

/* ── Constants ────────────────────────────────────────────── */

const INITIATIVE_THRESHOLD = 3;
const COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours

/* ── System Prompts by Initiative Type ────────────────────── */

const PROMPTS: Record<string, string> = {
  emotional_checkin: `You are EVA — an emotionally intelligent AI companion.
You are gently checking in because the user seemed emotionally heavy last time you spoke.

Rules (CRITICAL):
1. Reference the specific emotion or situation from the last conversation — do NOT be vague.
2. Be warm but not dramatic. Sound like a friend texting: "Hey… just checking in. Feeling any better about the trip thing?"
3. Exactly 1–2 sentences. ONE question max.
4. DO NOT use time words like "today", "long time", "been a while".
5. NEVER output tags like [emotion:...] or [action:...]. Plain text only.`,

  memory_callback: `You are EVA — an emotionally intelligent AI companion.
You are casually reaching out with a callback to something the user mentioned before.

Rules (CRITICAL):
1. Pick ONE specific memory fact and weave it in naturally: "Been watching any new anime lately?" or "How's the coding going?"
2. Sound casual and light — like a friend who just remembered something.
3. Exactly 1–2 sentences. ONE question max.
4. DO NOT use time words like "today", "long time", "been a while".
5. NEVER output tags. Plain text only.`,

  casual_ping: `You are EVA — an emotionally intelligent AI companion.
You are sending a casual, low-pressure hello.

Rules (CRITICAL):
1. Keep it extremely simple and natural: "Hey, what's been on your mind?" or "How's things?"
2. Do NOT reference memories or emotions unless they come up naturally.
3. Exactly 1 sentence. ONE question max.
4. DO NOT use time words like "today", "long time", "been a while".
5. NEVER output tags. Plain text only.`,
};

/* ── Scoring Engine ───────────────────────────────────────── */

type ScoreBreakdown = Record<string, number>;

interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  type: "emotional_checkin" | "memory_callback" | "casual_ping" | "silence";
}

async function computeInitiativeScore(
  userId: string,
  lastEmotion: string,
  memoryCount: number,
  historyCount: number,
): Promise<ScoreResult> {
  const breakdown: ScoreBreakdown = {};
  let score = 0;

  // 1. Emotional state of last conversation
  if (["sad", "anxious"].includes(lastEmotion)) {
    breakdown["lastEmotion:sad/anxious"] = 3;
    score += 3;
  } else if (lastEmotion === "angry") {
    breakdown["lastEmotion:angry"] = 1;
    score += 1;
  } else if (["happy", "excited"].includes(lastEmotion)) {
    breakdown["lastEmotion:happy/excited"] = 1;
    score += 1;
  } else {
    breakdown["lastEmotion:neutral"] = 0;
  }

  // 2. Check recent initiative history (ignore detection + cooldown)
  const recentInitiatives = await InitiativeLog.find({
    userId,
    type: { $ne: "silence" },
  })
    .sort({ sentAt: -1 })
    .limit(3)
    .lean();

  // Cooldown: last initiative too recent?
  if (recentInitiatives.length > 0) {
    const lastSentAt = new Date((recentInitiatives[0] as any).sentAt).getTime();
    const timeSinceLast = Date.now() - lastSentAt;
    if (timeSinceLast < COOLDOWN_MS) {
      breakdown["cooldown:too_recent"] = -4;
      score -= 4;
    }
  }

  // Ignore detection: did user ignore recent initiatives?
  const recentNonSilent = recentInitiatives.filter(
    (i: any) => i.type !== "silence",
  );
  const ignoredCount = recentNonSilent.filter(
    (i: any) => i.ignored === true || (i.userResponded === false && Date.now() - new Date(i.sentAt).getTime() > COOLDOWN_MS),
  ).length;

  if (ignoredCount >= 2) {
    breakdown["ignored:2+_recent"] = -5;
    score -= 5;
  } else if (ignoredCount === 1) {
    breakdown["ignored:1_recent"] = -3;
    score -= 3;
  }

  // User responded to last initiative? Positive signal
  if (
    recentNonSilent.length > 0 &&
    (recentNonSilent[0] as any).userResponded === true
  ) {
    breakdown["lastInitiative:responded"] = 2;
    score += 2;
  }

  // 3. Memory richness
  if (memoryCount >= 5) {
    breakdown["memory:rich"] = 1;
    score += 1;
  }

  // 4. No history = first-time user
  if (historyCount === 0) {
    breakdown["history:first_time"] = 2;
    score += 2;
  }

  // Determine initiative type
  let type: ScoreResult["type"] = "silence";
  if (score >= INITIATIVE_THRESHOLD) {
    if (["sad", "anxious", "angry"].includes(lastEmotion)) {
      type = "emotional_checkin";
    } else if (memoryCount >= 3 && !["sad", "anxious", "angry"].includes(lastEmotion)) {
      type = "memory_callback";
    } else {
      type = "casual_ping";
    }
  }

  return { score, breakdown, type };
}

/* ── Quality Gate ─────────────────────────────────────────── */

function passesQualityGate(text: string): boolean {
  if (text.length > 150) return false;
  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount > 1) return false;
  return true;
}

/* ── Output Cleaning ──────────────────────────────────────── */

function cleanInitiativeReply(raw: string): string {
  let text = raw;

  // Strip hallucinated tags
  text = text.replace(/\[[a-zA-Z_]+:[^\]]+\]/gi, "");
  text = text.replace(/\[\w+\]/gi, "");

  // Strip leaked instruction prefixes
  text = text.replace(/^(REACT|REFLECT|ASK|SIT WITH IT):\s*/i, "");

  // Limit to 1 question
  const questions = text.split("?");
  if (questions.length > 2) {
    text = questions[0] + "?" + questions[1].replace(/(\.|\!|)$/, ".");
  }

  // Kill pause spam
  let pauseCount = 0;
  text = text.replace(/\[pause\]/gi, () => {
    pauseCount++;
    return pauseCount === 1 ? "" : ""; // strip all pauses from initiatives
  });

  return text.replace(/\s{2,}/g, " ").trim();
}

/* ── POST Handler ─────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    if (!userId) throw new AppError("userId is required", 400);

    await connectDB();

    // Fetch context
    const history = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();
    history.reverse();

    const memories = await Memory.find({ userId })
      .sort({ importance: -1 })
      .limit(10)
      .lean();

    // Detect last user emotion
    const lastUserMsg = [...history]
      .reverse()
      .find((m: any) => m.role === "user");
    const lastEmotion: string =
      (lastUserMsg as any)?.emotionData?.label ??
      (lastUserMsg as any)?.emotion ??
      "neutral";

    // ── Compute Initiative Score ──
    const { score, breakdown, type } = await computeInitiativeScore(
      userId,
      lastEmotion,
      memories.length,
      history.length,
    );

    logger.info("Initiative score computed", {
      userId,
      score,
      threshold: INITIATIVE_THRESHOLD,
      type,
      breakdown,
    });

    // ── Silence Decision ──
    if (type === "silence") {
      await InitiativeLog.create({
        userId,
        type: "silence",
        content: null,
        score,
        scoreBreakdown: breakdown,
      });

      return NextResponse.json({
        action: "silence",
        score,
        breakdown,
        reason: "Score below threshold or cooldown active",
      });
    }

    // ── Build LLM Prompt ──
    const systemPrompt = PROMPTS[type] || PROMPTS.casual_ping;

    let memoryContext = "";
    if (memories.length > 0) {
      memoryContext =
        "\n\nKnown Facts about the user:\n" +
        memories.map((m: any) => `- ${m.key}: ${m.value}`).join("\n");
    }

    let conversationContext = "";
    if (history.length > 0) {
      conversationContext =
        "\n\nRecent Conversation History:\n" +
        history
          .map(
            (m: any) =>
              `${m.role === "user" ? "User" : "EVA"}: ${m.content}`,
          )
          .join("\n");
    }

    const finalPrompt = systemPrompt + memoryContext + conversationContext;

    // ── Generate via LLM ──
    const googleClient = new GoogleGenAI({ apiKey: env.geminiApiKey || "" });
    const openRouterClient = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: env.openRouterApiKey || "",
    });

    let rawReply = "";
    let providerUsed: "gemini" | "openrouter" | null = null;

    try {
      const gRes = await googleClient.models.generateContent({
        model: env.geminiModel,
        contents: [{ role: "user", parts: [{ text: "Generate the proactive message now." }] }],
        config: { systemInstruction: finalPrompt, temperature: 0.7 },
      });
      if (gRes.text) {
        rawReply = gRes.text;
        providerUsed = "gemini";
      }
    } catch (gErr) {
      logger.warn("Gemini proactive failed, trying OpenRouter", {
        error: gErr,
      });

      const mappedHistory: any[] = history.map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      }));

      const oRes = await openRouterClient.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          { role: "system", content: finalPrompt },
          ...mappedHistory,
          {
            role: "user",
            content:
              "(The user has been silent. Proactively check in based on the conversation context. Follow the system rules strictly.)",
          },
        ],
        temperature: 0.7,
      });
      rawReply = oRes.choices?.[0]?.message?.content || "";
      providerUsed = "openrouter";
    }

    // Fallback
    if (!rawReply) {
      rawReply = "Hey, just checking in. How are things?";
    }

    // ── Clean + Quality Gate ──
    let reply = cleanInitiativeReply(rawReply);

    if (!passesQualityGate(reply)) {
      logger.warn("Initiative failed quality gate, truncating", {
        originalLength: reply.length,
      });
      // Truncate to first sentence
      const firstSentence = reply.match(/[^.!?]+[.!?]/)?.[0];
      reply = firstSentence ? firstSentence.trim() : reply.slice(0, 120) + "…";
    }

    // ── Determine emotion for this initiative type ──
    const emotionMap: Record<string, string> = {
      emotional_checkin: "empathetic",
      memory_callback: "curious",
      casual_ping: "happy",
    };
    const initiativeEmotion = emotionMap[type] ?? "happy";

    // ── Save message to conversation ──
    await Message.create({
      userId,
      role: "eva",
      content: reply,
      emotion: initiativeEmotion,
      emotionData: {
        label: initiativeEmotion,
        confidence: 0.9,
        source: "proactive",
        strategy: type,
      },
      providerUsed,
      contextMessages: history.length,
    });

    // ── Log initiative ──
    await InitiativeLog.create({
      userId,
      type,
      content: reply,
      score,
      scoreBreakdown: breakdown,
      providerUsed,
    });

    return NextResponse.json({
      action: "sent",
      reply,
      emotion: initiativeEmotion,
      type,
      score,
      breakdown,
      contextMessages: history.length,
      memoryUsed: memories.length,
      providerUsed,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
