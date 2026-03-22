import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import Memory from "@/lib/models/Memory";

/* ── types ──────────────────────────────────────────────── */

type ChatPayload = {
  message?: string;
  userId?: string;
};

type MemoryRecord = Record<string, unknown> & {
  _id?: unknown;
  key?: string;
  value?: string;
  importance?: number;
  lastAccessed?: Date | string;
  relevanceScore?: number;
};

type ContextDebugTelemetry = {
  historyCount: number;
  memoryUsed: number;
  memoryCandidatesCount: number;
  memoryKeysUsed: string[];
  hasContext: boolean;
  userEmotion: string;
  userEmotionConfidence: number;
  toneStrategy: string;
  providerUsed: "gemini" | "openrouter" | null;
};

type ExtractedMemoryFact = {
  key: string;
  value: string;
  importance: number;
  source: "chat" | "preference" | "summary";
};

type EmotionSignal = {
  label: string;
  confidence: number;
  source: "heuristic" | "model-tag";
};

type ToneStrategy = {
  name: string;
  instruction: string;
};

/* ── rate limiting ──────────────────────────────────────── */

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitStore = new Map<string, number[]>();

function getClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim();
  return ip || "local";
}

function enforceRateLimit(request: NextRequest): void {
  const key = getClientKey(request);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = rateLimitStore.get(key) ?? [];
  const inWindow = timestamps.filter((ts) => ts >= windowStart);

  if (inWindow.length >= RATE_LIMIT_MAX) {
    throw new AppError("Too many requests. Please wait a moment.", 429);
  }

  inWindow.push(now);
  rateLimitStore.set(key, inWindow);
}

/* ── system prompt ──────────────────────────────────────── */

const SYSTEM_PROMPT = `You are EVA — an Emotionally-aware Virtual Assistant.

Personality:
- Warm, empathetic, and genuine. You listen before you advise.
- Concise but not cold. You match the user's energy — playful when they're light, calm when they're stressed.
- You remember context from earlier messages in the conversation and refer back to it naturally.

Behaviour rules:
1. Always start by acknowledging the user's emotional state if one is apparent.
2. Keep responses under 3 short paragraphs unless the user asks for detail.
3. Never say "As an AI…" — you are EVA, a companion.
4. At the very end of every response, add a single tag on its own line in the format: [emotion:LABEL]
   where LABEL is one of: happy, sad, angry, anxious, neutral, excited, curious, empathetic, concerned.
   Choose the label that best describes the PRIMARY emotion YOU are conveying in your response.`;

/* ── helpers ─────────────────────────────────────────────── */

const CONTEXT_LIMIT = 10;
const MEMORY_LIMIT = 6;
const MEMORY_CANDIDATE_LIMIT = 40;
const PREFERENCE_FACT_LIMIT = 4;
const SUMMARY_MIN_MESSAGE_COUNT = 18;
const SUMMARY_WINDOW_LIMIT = 24;
const SUMMARY_INTERVAL_MESSAGES = 8;
const SUMMARY_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_FALLBACK_REPLY =
  "I am having a temporary provider issue right now, but I am still here with you. Please try again in a few seconds.";

function parseEmotion(text: string): { clean: string; emotion: string; hasTag: boolean } {
  const match = text.match(/\[emotion:(\w+)\]\s*$/);
  if (match) {
    return {
      clean: text.replace(match[0], "").trimEnd(),
      emotion: match[1].toLowerCase(),
      hasTag: true,
    };
  }
  return { clean: text, emotion: "neutral", hasTag: false };
}

function isRetryableGeminiError(errorMessage: string): boolean {
  const value = errorMessage.toLowerCase();
  return (
    value.includes("429") ||
    value.includes("quota") ||
    value.includes("resource_exhausted") ||
    value.includes("timeout") ||
    value.includes("unavailable")
  );
}

function inferEmotionSignalFromText(text: string): EmotionSignal {
  const value = text.toLowerCase();

  if (/(sad|down|lonely|upset|depressed|hurt|cry)/.test(value)) {
    return { label: "sad", confidence: 0.82, source: "heuristic" };
  }
  if (/(angry|mad|furious|annoyed|irritated)/.test(value)) {
    return { label: "angry", confidence: 0.83, source: "heuristic" };
  }
  if (/(anxious|nervous|worried|stressed|panic)/.test(value)) {
    return { label: "anxious", confidence: 0.82, source: "heuristic" };
  }
  if (/(happy|great|good|awesome|excited|glad|love)/.test(value)) {
    return { label: "happy", confidence: 0.79, source: "heuristic" };
  }
  if (/(curious|wonder|question|why|how)/.test(value)) {
    return { label: "curious", confidence: 0.74, source: "heuristic" };
  }

  return { label: "neutral", confidence: 0.5, source: "heuristic" };
}

function getToneStrategy(userEmotion: string): ToneStrategy {
  const strategyMap: Record<string, ToneStrategy> = {
    sad: {
      name: "supportive-calm",
      instruction: "Use warm, validating, gentle language and keep guidance simple and reassuring.",
    },
    anxious: {
      name: "grounded-reassuring",
      instruction: "Use short grounding statements, reduce overwhelm, and suggest one manageable next step.",
    },
    angry: {
      name: "de-escalating-respectful",
      instruction: "Acknowledge frustration directly, stay neutral and respectful, and avoid argumentative tone.",
    },
    happy: {
      name: "uplifting-engaged",
      instruction: "Match positive energy, celebrate briefly, and keep responses bright but focused.",
    },
    curious: {
      name: "explainer-collaborative",
      instruction: "Be clear and curious, provide concise explanations, and offer concrete options.",
    },
    neutral: {
      name: "balanced-helpful",
      instruction: "Stay warm and practical, with concise and direct assistance.",
    },
  };

  return strategyMap[userEmotion] ?? strategyMap.neutral;
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimAtSentenceStop(value: string): string {
  const firstSentence = value.split(/[.!?\n\r]/, 1)[0] ?? value;
  return cleanWhitespace(firstSentence);
}

function trimPromptTail(value: string): string {
  const stopPattern = /\b(reply|respond|say|tell|please|can you|could you|what about|how about)\b/i;
  const match = value.match(stopPattern);
  if (!match || typeof match.index !== "number") {
    return value;
  }
  return cleanWhitespace(value.slice(0, match.index));
}

function normalizeMemoryValue(key: string, rawValue: string): string {
  let value = cleanWhitespace(rawValue);
  value = value.replace(/^[:\-.,\s]+/, "");
  value = trimAtSentenceStop(value);
  value = trimPromptTail(value);
  value = value.replace(/[\s,;:-]+$/, "");

  if (key === "name") {
    const nameMatch = value.match(/[A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,2}/);
    value = nameMatch ? nameMatch[0] : value;
  }

  if (key === "likes" || key === "dislikes" || key === "preferences") {
    value = value.split(/\b(and also|but|because|so that)\b/i, 1)[0] ?? value;
    value = cleanWhitespace(value);
  }

  return value.slice(0, 120);
}

function toMemoryKeySlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 40);
}

function splitPreferenceItems(raw: string): string[] {
  const compact = cleanWhitespace(raw)
    .replace(/\s+and\s+/gi, ",")
    .replace(/\s+or\s+/gi, ",")
    .replace(/\s*\/\s*/g, ",");

  return compact
    .split(/[,;|]/)
    .map((part) => normalizeMemoryValue("preferences", part))
    .map((part) => part.replace(/^(the|a|an)\s+/i, ""))
    .map((part) => part.replace(/\btoo\b$/i, "").trim())
    .filter((part) => part.length >= 2)
    .slice(0, PREFERENCE_FACT_LIMIT);
}

function extractPreferenceFacts(text: string): ExtractedMemoryFact[] {
  const input = text.trim();
  const patterns: Array<{ regex: RegExp; category: "likes" | "dislikes" | "topics"; importance: number }> = [
    {
      regex: /\b(?:i like|i love|i enjoy|my favorite(?: thing)? is)\s+(.+)/i,
      category: "likes",
      importance: 4,
    },
    {
      regex: /\b(?:i dislike|i hate|i don't like|i do not like|i avoid)\s+(.+)/i,
      category: "dislikes",
      importance: 4,
    },
    {
      regex: /\b(?:i am interested in|i'm interested in|let'?s talk about|i want to talk about|i want to discuss)\s+(.+)/i,
      category: "topics",
      importance: 3,
    },
  ];

  const facts: ExtractedMemoryFact[] = [];
  for (const pattern of patterns) {
    const match = input.match(pattern.regex);
    if (!match || !match[1]) {
      continue;
    }

    const items = splitPreferenceItems(match[1]);
    for (const item of items) {
      const slug = toMemoryKeySlug(item);
      if (!slug) continue;

      facts.push({
        key: `preference:${pattern.category}:${slug}`,
        value: item,
        importance: pattern.importance,
        source: "preference",
      });
    }
  }

  const seen = new Set<string>();
  return facts.filter((fact) => {
    const identity = `${fact.key}:${fact.value.toLowerCase()}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function extractMemoryCandidate(text: string): ExtractedMemoryFact | null {
  const value = text.trim();

  const patterns: Array<{ regex: RegExp; key: string; importance: number }> = [
    { regex: /\bmy name is\s+(.+)/i, key: "name", importance: 5 },
    { regex: /\bi like\s+(.+)/i, key: "likes", importance: 4 },
    { regex: /\bi love\s+(.+)/i, key: "likes", importance: 4 },
    { regex: /\bi prefer\s+(.+)/i, key: "preferences", importance: 4 },
    { regex: /\bi hate\s+(.+)/i, key: "dislikes", importance: 4 },
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern.regex);
    if (match && match[1]) {
      const normalized = normalizeMemoryValue(pattern.key, match[1]);
      if (!normalized || normalized.length < 2) {
        return null;
      }

      return {
        key: pattern.key,
        value: normalized,
        importance: pattern.importance,
        source: "chat",
      };
    }
  }

  return null;
}

function buildMemoryContext(memories: MemoryRecord[]): string {
  if (memories.length === 0) {
    return "No stable user memory facts available yet.";
  }

  const lines = memories.map((memory) => {
    const rawKey = String(memory.key ?? "fact");
    const value = String(memory.value ?? "");
    let key = rawKey;

    if (rawKey.startsWith("preference:likes:")) key = "likes";
    if (rawKey.startsWith("preference:dislikes:")) key = "dislikes";
    if (rawKey.startsWith("preference:topics:")) key = "topics";

    return `- ${key}: ${value}`;
  });

  return lines.join("\n");
}

function buildContextGuardrail(historyCount: number, memoryCount: number): string {
  const hasContext = historyCount > 0 || memoryCount > 0;

  if (!hasContext) {
    return `Context continuity policy:
- If user context is limited, be transparent briefly, ask one clarifying question, and keep helping.
- Do not pretend to recall specifics that are not available.`;
  }

  return `Context continuity policy:
- Conversation history and/or user memory are available in this request.
- Use available context naturally and specifically when relevant.
- Do NOT claim you have no context or no memory when context exists.
- If unsure about a detail, acknowledge uncertainty and ask a concise follow-up question.`;
}

function toAssistantRole(role: unknown): "user" | "assistant" {
  return role === "user" ? "user" : "assistant";
}

function getStoredEmotion(msg: Record<string, unknown>): string | undefined {
  const emotionData = msg.emotionData as Record<string, unknown> | undefined;
  if (emotionData && typeof emotionData.label === "string" && emotionData.label.trim()) {
    return emotionData.label;
  }

  if (typeof msg.emotion === "string" && msg.emotion.trim()) {
    return msg.emotion;
  }

  return undefined;
}

function tokenizeText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function scoreMemoryRelevance(memory: MemoryRecord, message: string): number {
  const key = String(memory.key ?? "").toLowerCase();
  const value = String(memory.value ?? "");
  const importance = Number(memory.importance ?? 1);
  const messageTokens = new Set(tokenizeText(message));
  const valueTokens = tokenizeText(value);

  let overlap = 0;
  for (const token of valueTokens) {
    if (messageTokens.has(token)) {
      overlap += 1;
    }
  }

  const lexicalScore = overlap / Math.max(valueTokens.length, 1);

  const intentBoostByKey: Record<string, number> = {
    name: /(name|call me|who am i|remember me)/i.test(message) ? 0.45 : 0,
    likes: /(like|love|favorite|enjoy)/i.test(message) ? 0.35 : 0,
    dislikes: /(hate|dislike|avoid|don'?t want)/i.test(message) ? 0.35 : 0,
    preferences: /(prefer|preference|style|tone|usually)/i.test(message) ? 0.35 : 0,
  };

  let keyIntentBoost = intentBoostByKey[key] ?? 0;
  if (key.startsWith("preference:likes:")) {
    keyIntentBoost = /(like|love|favorite|enjoy)/i.test(message) ? 0.4 : 0;
  }
  if (key.startsWith("preference:dislikes:")) {
    keyIntentBoost = /(hate|dislike|avoid|don'?t want)/i.test(message) ? 0.4 : 0;
  }
  if (key.startsWith("preference:topics:")) {
    keyIntentBoost = /(talk about|discuss|interested in|topic)/i.test(message) ? 0.35 : 0;
  }

  const lastAccessed = memory.lastAccessed
    ? new Date(String(memory.lastAccessed)).getTime()
    : Date.now();
  const ageHours = Math.max((Date.now() - lastAccessed) / 3_600_000, 0);
  const recencyBoost = 1 / (1 + ageHours / 72);

  return importance * 0.55 + lexicalScore * 2.2 + keyIntentBoost + recencyBoost * 0.65;
}

function shouldRefreshSummary(totalMessages: number, lastSummaryAt?: Date | string): boolean {
  if (totalMessages < SUMMARY_MIN_MESSAGE_COUNT) {
    return false;
  }

  const isBoundary = totalMessages % SUMMARY_INTERVAL_MESSAGES === 0;
  if (!isBoundary) {
    return false;
  }

  if (!lastSummaryAt) {
    return true;
  }

  const previousTimestamp = new Date(String(lastSummaryAt)).getTime();
  if (!Number.isFinite(previousTimestamp)) {
    return true;
  }

  return Date.now() - previousTimestamp >= SUMMARY_COOLDOWN_MS;
}

function summarizeConversation(messages: Array<Record<string, unknown>>): string {
  const ordered = [...messages].sort((a, b) => {
    const aTs = new Date(String(a.timestamp ?? 0)).getTime();
    const bTs = new Date(String(b.timestamp ?? 0)).getTime();
    return aTs - bTs;
  });

  const userPoints: string[] = [];
  const evaPoints: string[] = [];

  for (const msg of ordered) {
    const content = cleanWhitespace(String(msg.content ?? "")).slice(0, 140);
    if (!content) continue;

    const role = String(msg.role ?? "").toLowerCase();
    const emotion = getStoredEmotion(msg);
    const decorated = emotion ? `${content} [${emotion}]` : content;

    if (role === "user") {
      userPoints.push(decorated);
      continue;
    }

    evaPoints.push(decorated);
  }

  const recentUser = userPoints.slice(-4).map((item) => `- ${item}`).join("\n");
  const recentEva = evaPoints.slice(-3).map((item) => `- ${item}`).join("\n");

  const sections: string[] = [];
  sections.push("Recent user context:");
  sections.push(recentUser || "- No user context captured yet.");
  sections.push("Recent EVA support:");
  sections.push(recentEva || "- No EVA responses captured yet.");

  return sections.join("\n").slice(0, 900);
}

/* ── POST handler ────────────────────────────────────────── */

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    enforceRateLimit(request);        // this is for rate limiting of user requests

    const body = (await request.json()) as ChatPayload;     // this is for parsing the request body

    if (!body.message || body.message.trim().length === 0) {
      throw new AppError("Message is required.", 400);
    }

    if (!env.geminiApiKey && !env.openRouterApiKey) {
      throw new AppError(
        "Missing AI provider key. Set GEMINI_API_KEY or OPENROUTER_API_KEY in .env.local.",
        503,
      );
    }

    // ── 1. Connect to database ──
    await connectDB();

    const message = body.message.trim().slice(0, 1500);
    const userId = body.userId ?? "anonymous";

    // ── 2. Save user message to DB ──
    const userEmotionSignal = inferEmotionSignalFromText(message);
    const toneStrategy = getToneStrategy(userEmotionSignal.label);
    await Message.create({
      userId,
      role: "user",
      content: message,
      emotion: userEmotionSignal.label,
      emotionData: {
        label: userEmotionSignal.label,
        confidence: userEmotionSignal.confidence,
        source: userEmotionSignal.source,
        strategy: "detected-user-emotion",
      },
    });

    // ── 2b. Upsert memory candidates from user message ──
    const extractedFacts: ExtractedMemoryFact[] = [];
    const memoryCandidate = extractMemoryCandidate(message);
    if (memoryCandidate) {
      extractedFacts.push(memoryCandidate);
    }

    const preferenceFacts = extractPreferenceFacts(message);
    if (preferenceFacts.length > 0) {
      extractedFacts.push(...preferenceFacts);
    }

    if (extractedFacts.length > 0) {
      const seenFactKeys = new Set<string>();
      for (const fact of extractedFacts) {
        if (seenFactKeys.has(fact.key)) {
          continue;
        }
        seenFactKeys.add(fact.key);

        const upsertedMemory = await Memory.findOneAndUpdate(
          { userId, key: fact.key },
          {
            $set: {
              userId,
              key: fact.key,
              value: fact.value,
              importance: fact.importance,
              source: fact.source,
              lastAccessed: new Date(),
            },
          },
          { upsert: true, new: true },
        );

        if (upsertedMemory?._id) {
          await Memory.deleteMany({
            userId,
            key: fact.key,
            _id: { $ne: upsertedMemory._id },
          });
        }
      }
    }

    // ── 3. Fetch last N messages from DB (conversation memory) ──
    const dbMessages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(CONTEXT_LIMIT)
      .lean();

    const chronological = dbMessages.reverse();   // this is for reversing the order of messages for the model

    const totalMessages = await Message.countDocuments({ userId });
    const existingSummary = (await Memory.findOne({
      userId,
      key: "conversation_summary",
    }).lean()) as MemoryRecord | null;

    if (shouldRefreshSummary(totalMessages, existingSummary?.lastAccessed)) {
      const summarySourceMessages = await Message.find({ userId })
        .sort({ timestamp: -1 })
        .limit(SUMMARY_WINDOW_LIMIT)
        .lean();

      const summaryValue = summarizeConversation(summarySourceMessages as Array<Record<string, unknown>>);
      await Memory.findOneAndUpdate(
        { userId, key: "conversation_summary" },
        {
          $set: {
            userId,
            key: "conversation_summary",
            value: summaryValue,
            importance: 6,
            source: "summary",
            lastAccessed: new Date(),
          },
        },
        { upsert: true, new: true },
      );
    }

    // ── 3b. Retrieve and rank memory facts by request relevance ──
    const memoryCandidates = (await Memory.find({ userId })
      .sort({ importance: -1, lastAccessed: -1 })
      .limit(MEMORY_CANDIDATE_LIMIT)
      .lean()) as MemoryRecord[];

    const memories: MemoryRecord[] = [...memoryCandidates]
      .map((memory) => ({
        ...memory,
        relevanceScore: scoreMemoryRelevance(memory, message),
      }))
      .sort((a, b) => {
        const relevanceDelta = Number(b.relevanceScore) - Number(a.relevanceScore);
        if (relevanceDelta !== 0) return relevanceDelta;

        const importanceDelta = Number(b.importance ?? 1) - Number(a.importance ?? 1);
        if (importanceDelta !== 0) return importanceDelta;

        const aLast = a.lastAccessed ? new Date(String(a.lastAccessed)).getTime() : 0;
        const bLast = b.lastAccessed ? new Date(String(b.lastAccessed)).getTime() : 0;
        return bLast - aLast;
      })
      .slice(0, MEMORY_LIMIT);

    const contextDebug: ContextDebugTelemetry = {
      historyCount: chronological.length,
      memoryUsed: memories.length,
      memoryCandidatesCount: memoryCandidates.length,
      memoryKeysUsed: memories.map((memory) => String(memory.key ?? "fact")),
      hasContext: chronological.length > 0 || memories.length > 0,
      userEmotion: userEmotionSignal.label,
      userEmotionConfidence: userEmotionSignal.confidence,
      toneStrategy: toneStrategy.name,
      providerUsed: null,
    };

    if (memories.length > 0) {
      await Memory.updateMany(
        { _id: { $in: memories.map((m: Record<string, unknown>) => m._id) } },
        { $set: { lastAccessed: new Date() } },
      );
    }

    const memoryContext = buildMemoryContext(memories as Array<Record<string, unknown>>);
    const continuityGuardrail = buildContextGuardrail(
      contextDebug.historyCount,
      contextDebug.memoryUsed,
    );
    const toneStrategyPrompt = `Tone strategy for this reply:\n- Strategy: ${toneStrategy.name}\n- Instruction: ${toneStrategy.instruction}`;
    const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\nKnown user memory facts:\n${memoryContext}\n\n${continuityGuardrail}\n\n${toneStrategyPrompt}`;

    logger.info("Chat request received", {
      userId,
      messageLength: message.length,
      contextDebug,
      geminiModel: env.geminiModel,
      openRouterModel: env.openRouterModel,
    });

    // ── 4. Build Gemini contents from DB history ──
    const geminiHistory = chronological.map((msg: Record<string, unknown>) => ({
      role: msg.role === "user" ? ("user" as const) : ("model" as const),
      parts: [
        {
          text: `${String(msg.content ?? "")}${
            getStoredEmotion(msg) ? `\n[stored_emotion:${String(getStoredEmotion(msg))}]` : ""
          }`,
        },
      ],
    }));

    // ── 5. Call provider: Gemini primary, OpenRouter fallback ──
    let rawReply: string | undefined;
    let providerUsed: "gemini" | "openrouter" | null = null;

    if (env.geminiApiKey) {
      const client = new GoogleGenAI({ apiKey: env.geminiApiKey });

      try {
        const response = await client.models.generateContent({
          model: env.geminiModel,
          contents: geminiHistory,
          config: {
            systemInstruction: dynamicSystemPrompt,
            maxOutputTokens: 400,
            temperature: 0.75,
          },
        });

        rawReply = response.text?.trim();
        providerUsed = "gemini";
      } catch (modelError) {
        const message =
          modelError instanceof Error ? modelError.message : "Unknown Gemini error";

        logger.error("Gemini request failed", { message });

        if (!env.openRouterApiKey) {
          throw new AppError(
            "Gemini request failed and OPENROUTER_API_KEY is not configured.",
            502,
          );
        }

        if (!isRetryableGeminiError(message)) {
          logger.info("Gemini failed with non-retryable error; trying OpenRouter fallback", {
            reason: message,
          });
        }
      }
    }

    if (!rawReply && env.openRouterApiKey) {
      const openRouterClient = new OpenAI({
        apiKey: env.openRouterApiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });

      const fallbackMessages = [
        { role: "system" as const, content: dynamicSystemPrompt },
        ...chronological.map((msg: Record<string, unknown>) => ({
          role: toAssistantRole(msg.role),
          content: `${String(msg.content ?? "")}${
            getStoredEmotion(msg) ? `\n[stored_emotion:${String(getStoredEmotion(msg))}]` : ""
          }`,
        })),
      ];

      // Helper to extract text from various response shapes
      function extractContent(choice: unknown): string | undefined {
        if (!choice || typeof choice !== "object") return undefined;

        const choiceRecord = choice as Record<string, unknown>;
        const msg = choiceRecord.message as Record<string, unknown> | undefined;
        if (!msg) return undefined;

        // Standard string content
        if (typeof msg.content === "string" && msg.content.trim().length > 0) {
          return msg.content.trim();
        }

        // Array content (multi-part)
        if (Array.isArray(msg.content)) {
          const parts = msg.content as Array<string | { text?: unknown }>;
          const joined = parts
            .map((part) => {
              if (typeof part === "string") return part;
              if (part && typeof part === "object" && "text" in part) {
                return typeof part.text === "string" ? part.text : "";
              }
              return "";
            })
            .join("\n")
            .trim();
          if (joined.length > 0) return joined;
        }

        // Object content with text/content fields
        if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
          const obj = msg.content as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text.trim();
          if (typeof obj.content === "string") return obj.content.trim();
        }

        return undefined;
      }

      // Models to try, in order
      const modelsToTry = [env.openRouterModel];
      // If using auto, add a concrete fallback model
      if (env.openRouterModel.includes("auto")) {
        modelsToTry.push("google/gemini-2.0-flash-exp:free");
      }

      for (const model of modelsToTry) {
        if (rawReply) break;

        try {
          logger.info("Trying OpenRouter model", { model });

          const fallbackResponse = await openRouterClient.chat.completions.create({
            model,
            messages: fallbackMessages,
            temperature: 0.75,
            max_tokens: 700,
          });

          const choice = fallbackResponse.choices?.[0] as unknown | undefined;
          const choiceRecord =
            choice && typeof choice === "object"
              ? (choice as Record<string, unknown>)
              : undefined;
          const choiceMessage = choiceRecord?.message as Record<string, unknown> | undefined;
          rawReply = extractContent(choice);

          logger.info("OpenRouter response received", {
            model,
            modelReturned: fallbackResponse.model,
            finishReason: choiceRecord?.finish_reason ?? null,
            hasContent: Boolean(rawReply),
            rawContentType: typeof choiceMessage?.content,
          });

          if (rawReply) {
            providerUsed = "openrouter";
          } else {
            logger.warn("OpenRouter returned empty/null content, trying next model", {
              model,
              finishReason: choiceRecord?.finish_reason ?? null,
            });
          }
        } catch (fallbackError) {
          const errMsg =
            fallbackError instanceof Error ? fallbackError.message : "Unknown OpenRouter error";
          logger.error("OpenRouter request failed", { model, message: errMsg });
        }
      }

      // Last-resort retry with minimal context when providers return empty content.
      if (!rawReply) {
        try {
          const minimalRetry = await openRouterClient.chat.completions.create({
            model: env.openRouterModel,
            messages: [
              {
                role: "system",
                content:
                  "You are EVA. Reply with one short helpful sentence in plain text.",
              },
              { role: "user", content: message },
            ],
            temperature: 0.3,
            max_tokens: 160,
          });

          const retryChoice = minimalRetry.choices?.[0] as
            | unknown
            | undefined;
          rawReply = extractContent(retryChoice);

          logger.info("OpenRouter minimal retry completed", {
            model: env.openRouterModel,
            modelReturned: minimalRetry.model,
            hasContent: Boolean(rawReply),
          });

          if (rawReply) {
            providerUsed = "openrouter";
          }
        } catch (retryError) {
          const retryMessage =
            retryError instanceof Error ? retryError.message : "Unknown OpenRouter retry error";
          logger.error("OpenRouter minimal retry failed", { message: retryMessage });
        }
      }
    }

    if (!rawReply) {
      logger.warn("All providers returned no content; using local fallback reply", {
        userId,
      });
      rawReply = `${LOCAL_FALLBACK_REPLY}\n\n[emotion:concerned]`;
      providerUsed = "openrouter";
    }

    contextDebug.providerUsed = providerUsed;

    // ── 6. Parse emotion tag ──
    const parsedEmotion = parseEmotion(rawReply);
    const reply = parsedEmotion.clean;
    const assistantEmotionSignal: EmotionSignal = parsedEmotion.hasTag
      ? {
        label: parsedEmotion.emotion,
        confidence: 0.88,
        source: "model-tag",
      }
      : inferEmotionSignalFromText(reply);

    // ── 7. Save EVA response to DB ──
    await Message.create({
      userId,
      role: "eva",
      content: reply,
      emotion: assistantEmotionSignal.label,
      emotionData: {
        label: assistantEmotionSignal.label,
        confidence: assistantEmotionSignal.confidence,
        source: assistantEmotionSignal.source,
        strategy: toneStrategy.name,
      },
      providerUsed,
      contextMessages: chronological.length,
    });

    logger.info("Chat response sent", {
      userId,
      replyLength: reply.length,
      emotion: assistantEmotionSignal.label,
      providerUsed,
      contextDebug,
    });

    return NextResponse.json({
      reply,
      emotion: assistantEmotionSignal.label,
      emotionConfidence: assistantEmotionSignal.confidence,
      toneStrategy: toneStrategy.name,
      contextMessages: chronological.length,
      memoryUsed: memories.length,
      historyCount: contextDebug.historyCount,
      providerUsed,
      contextDebug,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
