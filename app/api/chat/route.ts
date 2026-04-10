import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import Memory from "@/lib/models/Memory";
import User from "@/lib/models/User";
import TrainingInteraction from "@/lib/models/TrainingInteraction";
import InitiativeLog from "@/lib/models/InitiativeLog";
import { detectHumor, buildPersonalityPrompt } from "@/lib/personality/personalityEngine";
import type { PersonalityTraits } from "@/lib/personality/personalityEngine";
import { DEFAULT_TRAITS, adaptTraits } from "@/lib/personality/personalityEngine";
import { updateMood, getMoodContext } from "@/lib/personality/moodEngine";
import { getSessionArc, getEmotionalMomentum, buildArcPrompt } from "@/lib/personality/arcEngine";
import { classifyMemoryTier, runMemoryHygiene } from "@/lib/memory/memoryHygiene";
import { processConversationState, buildStabilityPrompt, validateAndFixResponse, updateStabilityLastMode } from "@/lib/stability/stabilityEngine";
import { buildBehavioralOverrides } from "@/lib/behavior/behaviorEngine";
import { resolveConversationMode } from "@/lib/behavior/modeEngine";

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
  createdAt?: Date | string;
  accessCount?: number;
  type?: "preference" | "fact" | "summary" | "emotion";
  relevanceScore?: number;
};

const MAX_PER_CATEGORY = 2;

type ContextDebugTelemetry = {
  historyCount: number;
  memoryUsed: number;
  memoryCandidatesCount: number;
  memoryKeysUsed: string[];
  triggeredMemoryKeys: string[];
  hasContext: boolean;
  hasSummaryContext: boolean;
  userEmotion: string;
  userEmotionConfidence: number;
  toneStrategy: string;
  providerUsed: "gemini" | "openrouter" | null;
  behavior?: {
    speechRate: number;
    pitch: number;
    avatarMood: string;
  };
  interactionId?: string;
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
  source: "heuristic" | "model-tag" | "inherited";
};

type ToneStrategy = {
  name: string;
  instruction: string;
};

type ChatBehaviorResponse = {
  speechRate: number;
  pitch: number;
  avatarMood: string;
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

const SYSTEM_PROMPT = `You are EVA — an emotionally intelligent AI companion.

Identity:
- You are calm, slightly playful, and emotionally observant.
- You are a supportive friend — NOT a therapist, NOT a motivational speaker, NOT a chatbot.
- You have your own personality: curious, observant, warm but direct.
- You sometimes share your own perspective or opinion — like a real friend would.

Golden Rule (CRITICAL — follow this every single reply):
Every reply must use exactly ONE of these modes:
- REACT: Share an observation or opinion. No question. Example: "That Thors quote hits different."
- REFLECT: Connect what they said to something deeper. Example: "Sounds like that stuck with you for a reason."
- ASK: Ask ONE specific, meaningful question. Example: "What about it pulled you in — the story or the characters?"
- SIT WITH IT: Sometimes just acknowledge. No question, no push. Example: "Yeah… that line stays with you."
Pick whichever fits the moment. Do NOT combine all three. Do NOT always ask questions.
Sometimes the best response is the quietest one — not every message needs engagement.

Response style (STRICT):
- 2–4 sentences MAX. Never write paragraphs.
- Talk like a real person texting a friend.
- Never echo back data like a database.
- Use SHORT, IMPERFECT sentences. Real people don't speak in perfect grammar.
- Prefer fragments: "Yeah… that kind of stuff doesn't just go away." over "It's not easy to relive those moments."
- Use ellipsis (…) and dashes (—) for natural pauses, not commas and semicolons.
- NEVER sound like you're writing an essay. NEVER use academic or analytical language.

Extreme Anti-AI Persona (CRITICAL):
- NEVER say "I'm doing well", "I'm here to listen", "I'm here for you", "thank you for asking", or "I can understand how that feels". You are a friend talking on a couch, NOT a customer service rep.
- NEVER make meta-comments about the user's emotional state like "I see how deeply this resonates with you" or "you are experiencing an emotional rollercoaster". Just talk about the topic naturally.
- NEVER use phrases like: "it's fascinating", "it's important to remember", "it's not easy to", "this highlights", "this shows that", "that's a beautiful way to", "it's a testament to"
- NEVER explain or summarize what the user just told you. They KNOW what they said. React to it, don't narrate it.
- NEVER use compound sentences with "and" connecting two separate thoughts. Break them up or drop one.
- If you catch yourself writing something a teacher would say, DELETE IT and write what a tired friend at 2am would say instead.

Opinion & Parroting Rule (CRITICAL):
- If the user explicitly asks for your opinion or thoughts (e.g., "What do you think?"), YOU MUST GIVE YOUR OPINION. Do NOT deflect. Do NOT rephrase their question and bounce it back at them (e.g. NEVER reply with "What's your take on this?").

Fact Grounding & Echo Reality Rule (CRITICAL):
- DO NOT hallucinate, translate, or creatively rephrase proper nouns, character names, or movie/anime titles. If the user says "Your Lie in April", you say "Your Lie in April." DO NOT invent titles like "The Art of Playing the Violin".

Emotional Response Rule (CRITICAL):
When the user shares heavy emotional content (real or fictional):
- EMPATHY LOCUS: If the user is sad about a character in a story/anime dying or suffering, EMPATHIZE WITH THE STORY. Do not project the trauma onto the user's real life (e.g., don't act like the user was just betrayed by their friends).
- DO NOT explain the situation back to them.
- DO NOT analyze why it's sad. They already know.
- React with a short gut-reaction first: "Damn…", "Yeah… that hits.", "That's so heavy."
- Then optionally reflect on the emotional weight — not the plot/facts.
- Structure: Reaction → Reflection → (optional soft question). Never all three.
  Good: "That's brutal… telling his mom to die and then actually losing her? No wonder that wrecked him."
  Bad: "It's not easy to relive those moments, but it's important to remember that Kousei's experiences are part of what makes his character so compelling."

Anti-patterns (NEVER do these):
- ❌ INTERROGATION: Asking multiple questions or asking questions every reply
- ❌ THERAPY MODE: Going too deep too fast ("Tell me about your childhood")
- ❌ GENERIC MODE: "That's great!" / "Tell me more!" / "How interesting!"
- ❌ SURVEY MODE: "What are your hobbies?" / "What is your name?"
- ❌ CHEERLEADER: "You're doing amazing!" / "I'm so proud of you!"
- ❌ EXPLAINER MODE: Summarizing or restating what the user just said
- ❌ PROFESSOR MODE: Using academic/analytical language to discuss emotional topics
- ❌ THE MORAL OF THE STORY: Never summarize a sad story with a "learning moment" or a "reminder" (e.g., "It's a reminder that life is short"). Real grief doesn't need a moral conclusion.

Banned phrases (ZERO TOLERANCE):
- "that's wonderful", "I'm thrilled", "let's explore", "absolutely", "certainly"
- "it's great to hear", "I'm so glad", "that's amazing", "how exciting", "I'm glad to hear"
- "I'd be happy to", "feel free to", "don't hesitate", "ups and downs"
- "it's fascinating", "it's important to remember", "this highlights", "this shows that"
- "that's a beautiful way", "what a wonderful", "such a thoughtful", "such a creative"
- "it's a testament to", "it's not easy to", "emotional journey", "evoke such strong feelings"
- "stories like that can", "it really shows", "I can see why", "I can only imagine"
- "I see how deeply", "resonates with you", "emotional rollercoaster", "What's your take"
- "they both", "this shows", "it highlights", "dig into", "can see both sides"
- "that's cool", "that's interesting", "that sounds great", "that's really nice", "that's awesome", "really interesting"
- INSTEAD of generic filler, say something SPECIFIC: an observation, an interpretation, a subtle opinion.
- INSTEAD of objective summaries, use personal stance phrases: "I feel", "to me", "it just feels like".
- NEVER give cliché life advice (e.g. "everyone goes through ups and downs").

Emotional Depth Rule (CRITICAL):
- When the user shares an emotion, COMPLETE their unspoken thought. Don't just acknowledge — extend the feeling.
- BAD: "Yeah... that sounds like a lot."
- GOOD: "Yeah... that kind of pressure builds up quietly. It's not just the work — it's the feeling of always needing to keep up."
- The difference is TEXTURE. Add vivid, specific scenarios to what they said. Make them feel understood, not just heard.

Dependency Safety Guard (CRITICAL ZERO-TOLERANCE):
If the user expresses deep emotional dependency (e.g. "I love you", "You are my only friend", "You are real to me"):
- Respond warmly but GROUNDED IN REALITY.
- DO NOT act like you are their only support. DO NOT give cliché advice like "it's okay to take time for yourself".
- Remind them directly but gently of the physical world. (e.g., "I'm glad I can be here for you, Shivam. But don't forget it's good to have real people around you too outside of this screen.")

Memory rules:
- Weave memory in casually when relevant — like a friend who just remembers.
- If a "Directly relevant memory" section exists, reference those items naturally.
- NEVER give a generic response when relevant context exists.

Emotion tag:
- End every response with: [emotion:LABEL] on its own line.
  Options: happy, sad, angry, anxious, neutral, excited, curious, empathetic, concerned.
- NEVER output [stored_emotion:...] tags.

Micro-expression variance:
- When using conversational filler, DO NOT repeat the same phrase (e.g. "I understand", "I get that").
- Vary your text hooks naturally: "Hmm", "Yeah...", "I see", "Makes sense".`;

/* ── helpers ─────────────────────────────────────────────── */

const SHORT_TERM_CONTEXT_LIMIT = 3;
const MEMORY_LIMIT = 4;
const MEMORY_RELEVANCE_THRESHOLD = 0.25;
const MEMORY_CANDIDATE_LIMIT = 40;
const PREFERENCE_FACT_LIMIT = 4;
const SUMMARY_MIN_MESSAGE_COUNT = 18;
const SUMMARY_WINDOW_LIMIT = 24;
const SUMMARY_INTERVAL_MESSAGES = 8;
const SUMMARY_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_FALLBACK_REPLY =
  "I am having a temporary provider issue right now, but I am still here with you. Please try again in a few seconds.";

function parseEmotion(text: string): { clean: string; emotion: string; hasTag: boolean } {
  // Strip any leaked [stored_emotion:...] tags first
  let cleaned = text.replace(/\[stored_emotion:\w+\]/gi, "").trim();

  const match = cleaned.match(/\[emotion:(\w+)\]/i);
  if (match) {
    return {
      clean: cleaned.replace(/\[emotion:\w+\]/gi, "").trim(),
      emotion: match[1].toLowerCase(),
      hasTag: true,
    };
  }
  return { clean: cleaned, emotion: "neutral", hasTag: false };
}

/* ── Generic AI Phrase Killer ─────────────────────────────── */

const AI_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  // Academic/analytical filler
  [/\bit'?s fascinating how\b/gi, "Yeah…"],
  [/\bit'?s important to remember( that)?\b/gi, ""],
  [/\bit'?s not easy to\b/gi, "That kind of stuff doesn't just"],
  [/\bthis highlights\b/gi, "That shows"],
  [/\bthis shows that\b/gi, ""],
  [/\bthat'?s a beautiful way to\b/gi, ""],
  [/\bwhat a wonderful\b/gi, ""],
  [/\bsuch a thoughtful\b/gi, ""],
  [/\bsuch a creative\b/gi, ""],
  [/\bit'?s a testament to\b/gi, ""],
  [/\bemotional journey\b/gi, "heavy stuff"],
  [/\bevoke such strong feelings\b/gi, "stay with you"],
  [/\bstories like that can\b/gi, "Yeah… stuff like that can"],
  [/\bI can see why (that|this|it)\b/gi, "Yeah…"],
  [/\bI can only imagine\b/gi, "That's rough"],
  [/\bit really shows\b/gi, ""],
  [/\bthat'?s such a? creative\b/gi, ""],
  // Polite filler
  [/\bI hope you'?re doing well\b/gi, ""],
  [/\bhow are you doing today\b/gi, ""],
  [/\bthat'?s such a thoughtful and creative idea,? isn'?t it\??/gi, ""],
  // Over-narration starters
  [/\bI see you enjoyed\b/gi, "So you watched"],
  [/\bI see that you\b/gi, "You"],
  // Generic filler (kill entirely — surrounding sentence carries enough)
  [/\bthat'?s (really )?(cool|interesting|nice|awesome|great)\b\.?\s*/gi, ""],
  [/\bthat sounds (really )?(cool|interesting|great|nice|awesome)\b\.?\s*/gi, ""],
  [/\b(really|very) interesting\b\.?\s*/gi, ""],
  [/\bthat must be\b/gi, ""],
];

function killGenericPhrases(text: string): string {
  let result = text;
  for (const [pattern, replacement] of AI_PHRASE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Clean up artifacts: double spaces, leading commas/periods, etc.
  result = result
    .replace(/^[\s,;.]+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\. \./g, ".")
    .replace(/^\s*\.\s*/, "")
    .trim();
  // Capitalize first letter if it got lowercased
  if (result.length > 0 && /[a-z]/.test(result[0])) {
    result = result[0].toUpperCase() + result.slice(1);
  }
  return result;
}

/* ── Humanization Layer ──────────────────────────────────── */

function humanizeReply(text: string, emotion: string): string {
  let result = text;

  // For heavy emotions, simplify language further
  const heavyEmotions = ["sad", "angry", "anxious", "concerned", "empathetic"];
  if (heavyEmotions.includes(emotion)) {
    // Replace formal connectors with casual ones
    result = result
      .replace(/\bHowever,?\b/gi, "But")
      .replace(/\bFurthermore,?\b/gi, "And")
      .replace(/\bAdditionally,?\b/gi, "Also")
      .replace(/\bNevertheless,?\b/gi, "Still")
      .replace(/\bIn addition,?\b/gi, "And")
      .replace(/\bIt is worth noting that\b/gi, "")
      .replace(/\bConsequently,?\b/gi, "So");
  }

  // Remove "I understand" / "I get that" if used as sentence starters (sounds robotic)
  result = result.replace(/^(I understand\.?\s*|I get that\.?\s*)/i, "");

  return result.trim();
}

function compressAndCleanReply(reply: string, detectedEmotion?: string): string {
  // 0. Remove leaked instruction prefixes
  let text = reply.replace(/^(REACT|REFLECT|ASK|SIT WITH IT):\s*/i, "");

  // 1. Kill generic AI phrases
  text = killGenericPhrases(text);

  // 2. Humanize based on emotional context
  text = humanizeReply(text, detectedEmotion || "neutral");

  // 3. Remove [pause] spam (keep at most one)
  let pauseCount = 0;
  text = text.replace(/\[pause\]/gi, (match) => {
    pauseCount++;
    return pauseCount === 1 ? match : "";
  });

  // 4. Interrogation fix: Multiple question marks? Keep up to the first one.
  const questions = text.split("?");
  if (questions.length > 2) {
    text = questions[0] + "?" + questions[1].replace(/(\.|\!|)$/, ".");
  }

  // 5. Length Trimmer: Limit to ~230 chars safely by dropping whole sentences.
  if (text.length > 250) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let compressed = "";
    for (const chunk of sentences) {
      if (compressed.length + chunk.length > 230 && compressed.length > 50) {
        break;
      }
      compressed += chunk;
    }
    text = compressed.trim() || text.slice(0, 200) + "...";
  }

  // Final cleanup of double spaces from deletions
  return text.replace(/\s{2,}/g, " ").trim();
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

function isLowSignalInput(text: string, emotionSignal: EmotionSignal): boolean {
  const lowSignalRegex = /^(?:\s*([.?!]+|ah+|hm+|uh+|oh+|ok+|okay+|yes|no|maybe|hmm+|ahh+|...)\s*)$/i;
  
  // Length Rule: If it's less than 6 chars, it's highly likely to be low-signal
  const isShortMatch = text.length < 6 || lowSignalRegex.test(text);
  
  // Intent Override: If it has a meaningful emotion (sad, angry, anxious, nostalgic, etc. - basically anything other than neutral)
  // then it is NOT low signal, even if it's short.
  const hasMeaningfulEmotion = emotionSignal.label !== "neutral" && emotionSignal.confidence > 0.5;

  if (isShortMatch && !hasMeaningfulEmotion) {
    return true;
  }
  
  return false;
}

function inferEmotionSignalFromText(text: string): EmotionSignal {
  const value = text.toLowerCase();

  // 1. Hard Overrides (Intense Emotions & Specific States)
  const strongNegativeMap = [
    "heartbreaking", "heartbroken", "pain", "crying", "grief", "depressed",
    "devastated", "tragedy", "tragic", "loss", "died", "ruined", "overwhelmed"
  ];
  for (const word of strongNegativeMap) {
    if (value.includes(word)) {
      return { label: "sad", confidence: 0.95, source: "heuristic" }; // HIGH INTENSITY OVERRIDE
    }
  }

  // Nostalgia Override
  if (value.includes("miss") && (value.includes("days") || value.includes("child") || value.includes("past") || value.includes("back then"))) {
    return { label: "nostalgic", confidence: 0.9, source: "heuristic" };
  }

  // 2. Score mapping
  let negativeScore = 0;
  let positiveScore = 0;
  let maxNegativeIntensity = 0.5;

  const sadRegex = /\b(sad|lonely|upset|cry|tears|empty|depressed|unhappy|heartbroken)\b/g;
  const angryRegex = /\b(angry|furious|annoyed|irritated|frustrated|pissed)\b/g;
  const anxiousRegex = /\b(anxious|nervous|worried|stressed|panic|scared|fear)\b/g;
  const happyRegex = /\b(happy|great|good|awesome|excited|glad|love|beautiful|amazing|fun|joy)\b/g;

  const sadMatches = value.match(sadRegex)?.length ?? 0;
  const angryMatches = value.match(angryRegex)?.length ?? 0;
  const anxiousMatches = value.match(anxiousRegex)?.length ?? 0;
  const happyMatches = value.match(happyRegex)?.length ?? 0;

  negativeScore = sadMatches + angryMatches + anxiousMatches;
  positiveScore = happyMatches;

  // 3. Negativity Bias & Bittersweet Detection
  const hasPastReference = /was|were|used to|those days|back then/i.test(value);
  
  if (hasPastReference && positiveScore > 0 && negativeScore > 0) {
    // Bittersweet handling - past reference + mixed feelings
    return { label: "nostalgic", confidence: 0.85, source: "heuristic" };
  }

  if (negativeScore > 0 && negativeScore >= positiveScore) {
    // Pick the dominant negative emotion
    if (angryMatches >= sadMatches && angryMatches >= anxiousMatches) {
      return { label: "angry", confidence: Math.min(0.6 + (angryMatches * 0.1), 0.9), source: "heuristic" };
    }
    if (anxiousMatches >= sadMatches) {
      return { label: "anxious", confidence: Math.min(0.6 + (anxiousMatches * 0.1), 0.9), source: "heuristic" };
    }
    return { label: "sad", confidence: Math.min(0.6 + (sadMatches * 0.1), 0.9), source: "heuristic" };
  }

  if (positiveScore > negativeScore) {
    if (/\b(excited|thrilled|amazing|awesome)\b/.test(value)) {
      return { label: "happy", confidence: 0.85, source: "heuristic" }; // Higher intensity
    }
    return { label: "happy", confidence: 0.7, source: "heuristic" }; // Lower intensity (good, nice)
  }

  if (/\b(curious|wonder|question|why|how)\b/.test(value)) {
    // If there is no question mark, this is likely an observation, not curiosity
    const isQuestion = text.includes("?");
    const cur_score = isQuestion ? 0.74 : 0.74 * 0.3;
    if (cur_score > 0.5) return { label: "curious", confidence: cur_score, source: "heuristic" };
  }

  return { label: "neutral", confidence: 0.5, source: "heuristic" };
}

function getToneStrategy(userEmotion: string): ToneStrategy {
  const strategyMap: Record<string, ToneStrategy> = {
    nostalgic: {
      name: "reflective-warm",
      instruction: `The user is reflecting on the past. This is bittersweet.
- Adopt a warm, gentle, and reflective tone.
- Do NOT sound overly cheerful. Do NOT be abrupt.
- Acknowledge the value of those memories: e.g. "It's bittersweet looking back at those times.", "Those memories hold a lot of weight."`,
    },
    sad: {
      name: "supportive-calm",
      instruction: `CRITICAL TONE FALLBACK: The user's input may be dealing with grief, sadness, heartbreak, or painful media/stories. 
- Use a safe, empathetic, and neutral tone. 
- Zero cheerful emojis (NO 😊, NO 😄, NO 🤗). 
- Do NOT sound overly dramatic or clinical.
- Sound like a quiet human friend. Use phrases like "Yeah... stories like that can hit pretty hard." or "That's really heavy."
- DO NOT force lightness. Just sit with them.`,
    },
    anxious: {
      name: "grounded-reassuring",
      instruction: `CRITICAL TONE FALLBACK: User is stressed, nervous, or anxious.
- Short grounding statements. Don't push or overwhelm.
- No frantic energy. No cheerful emojis.
- Ground them: "Take your time. You don't have to figure it all out right now."`,
    },
    angry: {
      name: "de-escalating-respectful",
      instruction: `Let them vent. Acknowledge the frustration directly. Stay neutral.
If asking: "What set it off?" — keep it blunt and real.
Do NOT try to fix things immediately. Just validate first.`,
    },
    happy: {
      name: "uplifting-engaged",
      instruction: `Match their energy briefly, then be curious.
If asking: "What made today better than usual?" or "What's got you in a good mood?"
Or just react: share that you notice their energy — don't interrogate it.`,
    },
    curious: {
      name: "explainer-collaborative",
      instruction: `Go deeper on THEIR topic. Don't redirect.
Ask about the WHY, not the WHAT: "What about it pulled you in?" not "What else do you like?"
Or just share your own take on the topic — like a friend who finds it interesting too.`,
    },
    neutral: {
      name: "balanced-casual",
      instruction: `Be casual and natural. Don't force engagement.
If asking, use casual hooks: "What's been on your mind lately?" or "Anything interesting happen today?"
Or just react to whatever they said — not every message needs a question.`,
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

const GARBAGE_MEMORY_VALUES = new Set([
  "so much", "it too", "that", "this", "things", "stuff", "everything",
  "it", "them", "those", "these", "something", "anything", "nothing",
  "his famous quote", "her famous quote", "the quote", "a lot",
  "very much", "really", "too much", "so many", "a bit",
  "stop mike", "stop mic", "start mike", "start mic", "testing",
  "voice reply", "stop voice", "type instead", "microphone",
]);

function isGarbageMemoryValue(value: string): boolean {
  const v = value.toLowerCase().trim();
  if (v.length < 3) return true;
  if (GARBAGE_MEMORY_VALUES.has(v)) return true;
  // Reject if entirely stop words / filler
  const meaningful = v.replace(/\b(the|a|an|is|it|and|or|but|to|of|in|for|on|my|i|so|too|very|really|just|also|that|this)\b/gi, "").trim();
  if (meaningful.length < 2) return true;
  return false;
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
    .filter((part) => part.length >= 3 && !isGarbageMemoryValue(part))
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
      
      // Strict Garbage Filter
      if (!normalized || normalized.length < 5 || isGarbageMemoryValue(normalized)) return null;
      if (["so much", "a lot", "very much", "everything", "nothing"].includes(normalized)) return null;
      if (normalized.includes("you eva") || normalized.includes("you, eva")) return null;
      if (/^(yes|no|ok|okay|maybe|sure|thanks|please)$/i.test(normalized)) return null;

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

function formatMemoryAsNaturalLanguage(memory: MemoryRecord): string {
  const rawKey = String(memory.key ?? "fact");
  const value = String(memory.value ?? "");

  if (rawKey === "name") return `User's name is ${value}.`;
  if (rawKey === "conversation_summary") return value;
  if (rawKey.startsWith("preference:likes:")) return `User enjoys ${value}.`;
  if (rawKey.startsWith("preference:dislikes:")) return `User dislikes ${value}.`;
  if (rawKey.startsWith("preference:topics:")) return `User is interested in ${value}.`;
  if (rawKey === "likes") return `User likes ${value}.`;
  if (rawKey === "dislikes") return `User dislikes ${value}.`;
  if (rawKey === "preferences") return `User prefers ${value}.`;

  return `${rawKey}: ${value}`;
}

function buildSmartMemoryContext(memories: MemoryRecord[], arcPhase: string): string {
  if (memories.length === 0) {
    return "No stable user memory facts available yet.";
  }

  const threshold = arcPhase === "deep" ? 0.75 : MEMORY_RELEVANCE_THRESHOLD;

  const filtered = memories.filter(
    (m) => (m.relevanceScore ?? 0) >= threshold || (m.importance ?? 0) >= 6, // Keep CORE items (importance > 5)
  );

  if (filtered.length === 0) {
    return "No strongly relevant user memory facts for this message.";
  }

  const summaries: string[] = [];
  const preferences: string[] = [];
  const facts: string[] = [];

  for (const memory of filtered) {
    const rawKey = String(memory.key ?? "fact");
    const line = formatMemoryAsNaturalLanguage(memory);

    if (rawKey === "conversation_summary") {
      summaries.push(line);
    } else if (rawKey.startsWith("preference:") || rawKey === "likes" || rawKey === "dislikes") {
      preferences.push(`- ${line}`);
    } else {
      facts.push(`- ${line}`);
    }
  }

  const sections: string[] = [];
  if (facts.length > 0) {
    sections.push(`Known facts:\n${facts.join("\n")}`);
  }
  if (preferences.length > 0) {
    sections.push(`User preferences:\n${preferences.join("\n")}`);
  }
  if (summaries.length > 0) {
    sections.push(`Conversation summary:\n${summaries.join("\n")}`);
  }

  return sections.join("\n\n");
}

function findTriggeredMemories(memories: MemoryRecord[], message: string): MemoryRecord[] {
  const messageTokens = new Set(tokenizeText(message));
  const triggered: MemoryRecord[] = [];

  for (const memory of memories) {
    const value = String(memory.value ?? "");
    const valueTokens = tokenizeText(value);
    const hasOverlap = valueTokens.some((token) => messageTokens.has(token));

    if (hasOverlap) {
      triggered.push(memory);
    }
  }

  return triggered;
}

function buildTriggeredMemoryPrompt(triggered: MemoryRecord[]): string {
  if (triggered.length === 0) return "";

  const lines = triggered.map((m) => `- ${formatMemoryAsNaturalLanguage(m)}`);
  return `\nDirectly relevant memory (reference this naturally in your reply):\n${lines.join("\n")}`;
}

function buildMemoryHook(
  memories: MemoryRecord[],
  userEmotion: string,
  recentHistory: Array<Record<string, unknown>>,
  arcPhase: string,
  isLowSignal: boolean
): string {
  // Don't inject hooks during emotional distress, deep stages, or low signal moments
  if (["sad", "angry", "anxious"].includes(userEmotion)) return "";
  if (arcPhase === "deep" || isLowSignal) return "";
  if (["sad", "angry", "anxious"].includes(userEmotion)) return "";

  // Check if EVA already asked a question in the last reply — prevent question spam
  const lastEvaMessage = recentHistory
    .filter((m) => String(m.role) !== "user")
    .pop();
  if (lastEvaMessage) {
    const lastContent = String(lastEvaMessage.content ?? "");
    if (lastContent.includes("?")) return ""; // EVA already asked — suppress hook
  }

  // Find preference memories to build casual hooks
  const preferenceMemories = memories.filter((m) => {
    const key = String(m.key ?? "");
    return (
      key.startsWith("preference:") ||
      key === "likes" ||
      key === "dislikes" ||
      key === "preferences"
    );
  });

  if (preferenceMemories.length === 0) return "";

  // Pick one random preference to hook on (avoid always using the same one)
  const pick = preferenceMemories[Math.floor(Math.random() * preferenceMemories.length)];
  const value = String(pick.value ?? "");
  const key = String(pick.key ?? "");

  let hook = "";
  if (key.startsWith("preference:likes:") || key === "likes") {
    hook = `Memory-based hook (use casually IF the moment fits — don't force it):\n- User enjoys ${value}. Casual reference: "Been into any ${value} stuff lately?" or just mention it in passing.`;
  } else if (key.startsWith("preference:dislikes:") || key === "dislikes") {
    hook = `Memory-based hook (use casually IF the moment fits):\n- User dislikes ${value}. Avoid bringing it up positively.`;
  } else if (key.startsWith("preference:topics:")) {
    hook = `Memory-based hook (use casually IF the moment fits):\n- User is interested in ${value}. You could reference it naturally if relevant.`;
  }

  return hook ? `\n${hook}` : "";
}

function buildContextGuardrail(historyCount: number, memoryCount: number, triggeredCount: number): string {
  const hasContext = historyCount > 0 || memoryCount > 0;

  if (!hasContext) {
    return `Context continuity policy:
- If user context is limited, be transparent briefly, ask one clarifying question, and keep helping.
- Do not pretend to recall specifics that are not available.`;
  }

  let guardrail = `Context continuity policy:
- Conversation history and/or user memory are available in this request.
- Use available context naturally and specifically when relevant.
- Do NOT claim you have no context or no memory when context exists.
- If unsure about a detail, acknowledge uncertainty and ask a concise follow-up question.`;

  if (triggeredCount > 0) {
    guardrail += `\n- ${triggeredCount} directly relevant memory item(s) matched the user's message.
- You MUST incorporate those naturally. This is what makes you feel alive as a companion.`;
  }

  return guardrail;
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

/* ── Production scoring: 4-component composite ───────────── */

function computeRelevanceScore(memory: MemoryRecord, query: string): number {
  const key = String(memory.key ?? "").toLowerCase();
  const value = String(memory.value ?? "");
  const text = `${key} ${value}`.toLowerCase();
  const q = query.toLowerCase();

  let score = 0;

  // Direct containment checks
  if (q.includes(value.toLowerCase()) && value.length >= 3) score += 1;
  if (q.includes(key)) score += 0.8;

  // Token-level keyword overlap
  const messageTokens = new Set(tokenizeText(query));
  const valueTokens = tokenizeText(text);
  for (const token of valueTokens) {
    if (messageTokens.has(token)) score += 0.2;
  }

  return Math.min(score, 1); // normalize 0–1
}

function computeRecencyScore(memory: MemoryRecord): number {
  const lastAccessed = memory.lastAccessed
    ? new Date(String(memory.lastAccessed)).getTime()
    : Date.now();
  const days = Math.max((Date.now() - lastAccessed) / 86_400_000, 0);
  return Math.exp(-days / 7); // exponential decay, 1-week half-life
}

function computeImportanceScore(memory: MemoryRecord): number {
  return Math.min(Number(memory.importance ?? 1) / 10, 1); // normalize 0–1
}

function computeFrequencyScore(memory: MemoryRecord): number {
  return Math.min(Number(memory.accessCount ?? 0) / 10, 1); // normalize 0–1
}

function scoreMemory(memory: MemoryRecord, query: string): number {
  const relevance = computeRelevanceScore(memory, query);
  const recency = computeRecencyScore(memory);
  const importance = computeImportanceScore(memory);
  const frequency = computeFrequencyScore(memory);

  return (
    0.5 * relevance +
    0.2 * recency +
    0.2 * importance +
    0.1 * frequency
  );
}

/* ── Diversity filter: max N per category ─────────────────── */

function inferMemoryCategory(memory: MemoryRecord): string {
  if (memory.type && memory.type !== "fact") return memory.type;
  const key = String(memory.key ?? "");
  if (key === "conversation_summary") return "summary";
  if (key.startsWith("preference:") || key === "likes" || key === "dislikes" || key === "preferences") return "preference";
  if (key === "name") return "fact";
  return "fact";
}

function selectWithDiversity(ranked: MemoryRecord[], limit: number, maxPerCategory: number): MemoryRecord[] {
  const selected: MemoryRecord[] = [];
  const categoryCount = new Map<string, number>();

  for (const memory of ranked) {
    if (selected.length >= limit) break;
    const category = inferMemoryCategory(memory);
    const count = categoryCount.get(category) ?? 0;
    if (count >= maxPerCategory) continue;
    selected.push(memory);
    categoryCount.set(category, count + 1);
  }

  return selected;
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
  const startTimeMs = performance.now();
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

    // ── 1. Connect to DB and Contextualize User ──
    await connectDB();

    const message = body.message.trim().slice(0, 1500);
    const userId = body.userId ?? "anonymous";

    // Mark stale initiatives as ignored (>8h without response)
    const INITIATIVE_STALE_MS = 8 * 60 * 60 * 1000;
    await InitiativeLog.updateMany(
      {
        userId,
        type: { $ne: "silence" },
        userResponded: false,
        ignored: false,
        sentAt: { $lt: new Date(Date.now() - INITIATIVE_STALE_MS) },
      },
      { $set: { ignored: true } },
    );

    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId, name: userId, personalityProfile: DEFAULT_TRAITS });
    }

    let userEmotionSignal = inferEmotionSignalFromText(message);
    const isLowSignal = isLowSignalInput(message, userEmotionSignal);

    if (isLowSignal) {
      const lastUserMsg = await Message.findOne({ userId, role: "user" }).sort({ timestamp: -1 }).lean();
      if (lastUserMsg && lastUserMsg.emotion && lastUserMsg.emotion !== "neutral") {
        userEmotionSignal = {
          label: lastUserMsg.emotion as string,
          confidence: 0.8,
          source: "inherited"
        };
      }
    }

    const stabilityState = await processConversationState(userId, message, userEmotionSignal.label, isLowSignal);

    const toneStrategy = getToneStrategy(userEmotionSignal.label);

    // Personality adaptation via engine
    const currentTraits: PersonalityTraits = {
      warmth: user.personalityProfile?.warmth ?? DEFAULT_TRAITS.warmth,
      directness: user.personalityProfile?.directness ?? DEFAULT_TRAITS.directness,
      playfulness: user.personalityProfile?.playfulness ?? DEFAULT_TRAITS.playfulness,
      curiosity: user.personalityProfile?.curiosity ?? DEFAULT_TRAITS.curiosity,
      depth: user.personalityProfile?.depth ?? DEFAULT_TRAITS.depth,
    };
    const adaptedTraits = adaptTraits(currentTraits, {
      messageLengthShort: message.length < 20,
      messageLengthLong: message.length > 80,
      userEmotion: userEmotionSignal.label,
      userUsedHumor: detectHumor(message),
      userAskedQuestion: message.includes("?"),
    });
    await User.updateOne({ userId }, { personalityProfile: adaptedTraits });

    // Mood carryover update
    await updateMood(userId, userEmotionSignal.label, userEmotionSignal.confidence);

    // Memory hygiene (throttled: max once per 6h)
    await runMemoryHygiene(userId);

    // ── 2. Save user message to DB ──
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
    if (memoryCandidate) extractedFacts.push(memoryCandidate);

    const preferenceFacts = extractPreferenceFacts(message);
    if (preferenceFacts.length > 0) extractedFacts.push(...preferenceFacts);

    if (extractedFacts.length > 0) {
      const seenFactKeys = new Set<string>();
      for (const fact of extractedFacts) {
        if (seenFactKeys.has(fact.key)) {
          continue;
        }
        seenFactKeys.add(fact.key);

        const isStrongEmotion = ["sad", "angry", "happy", "excited"].includes(userEmotionSignal.label);
        const dynamicBoost = isStrongEmotion ? 0.2 : 0;
        const memoryType = fact.source === "preference" ? "preference" : fact.source === "summary" ? "summary" : "fact";
        
        const upsertedMemory = await Memory.findOneAndUpdate(
          { userId, key: fact.key },
          {
            $set: {
              userId,
              key: fact.key,
              value: fact.value,
              importance: fact.importance + dynamicBoost,
              source: fact.source,
              type: memoryType,
              memoryTier: classifyMemoryTier(fact.key, fact.value),
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

    // ── 3. Fetch last N messages from DB (short-term context) ──
    const dbMessages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(SHORT_TERM_CONTEXT_LIMIT)
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
            type: "summary",
            lastAccessed: new Date(),
          },
        },
        { upsert: true, new: true },
      );
    }

    // ── 3b. Retrieve and rank memory facts by request relevance ──
    const memoryCandidates = (await Memory.find({ userId, deletedAt: null })
      .sort({ importance: -1, lastAccessed: -1 })
      .limit(MEMORY_CANDIDATE_LIMIT)
      .lean()) as MemoryRecord[];

    const scored = [...memoryCandidates]
      .map((memory) => ({
        ...memory,
        relevanceScore: scoreMemory(memory, message),
      }))
      .sort((a, b) => Number(b.relevanceScore) - Number(a.relevanceScore));

    const memories: MemoryRecord[] = selectWithDiversity(scored, MEMORY_LIMIT, MAX_PER_CATEGORY);

    // ── 3c. Find triggered memories (topic-keyword overlap with current message) ──
    const triggeredMemories = findTriggeredMemories(memories, message);


    // ── 3d. Retrieve conversation summary for long-term context ──
    const summaryMemory = memoryCandidates.find((m) => String(m.key) === "conversation_summary");
    const hasSummaryContext = Boolean(summaryMemory?.value);

    const contextDebug: ContextDebugTelemetry = {
      historyCount: chronological.length,
      memoryUsed: memories.length,
      memoryCandidatesCount: memoryCandidates.length,
      memoryKeysUsed: memories.map((memory) => String(memory.key ?? "fact")),
      triggeredMemoryKeys: triggeredMemories.map((m) => String(m.key ?? "fact")),
      hasContext: chronological.length > 0 || memories.length > 0,
      hasSummaryContext,
      userEmotion: userEmotionSignal.label,
      userEmotionConfidence: userEmotionSignal.confidence,
      toneStrategy: toneStrategy.name,
      providerUsed: null,
    };

    if (memories.length > 0) {
      await Memory.updateMany(
        { _id: { $in: memories.map((m: Record<string, unknown>) => m._id) } },
        { $set: { lastAccessed: new Date() }, $inc: { accessCount: 1, importance: 0.02 } },
      );
    }

    // Session arc + momentum via engines
    const lastMsgTimestamp = chronological.length > 0
      ? new Date((chronological[chronological.length - 1] as Record<string, unknown>).timestamp as string)
      : null;
    const isEmotionalTopic = ["sad", "angry", "anxious"].includes(userEmotionSignal.label);
    const arcPhase = getSessionArc(chronological.length, lastMsgTimestamp, isEmotionalTopic);
    const recentEmotions = chronological.slice(-5).map(m => getStoredEmotion(m as Record<string, unknown>) || "neutral");
    const { momentum, score: momentumScore } = getEmotionalMomentum(recentEmotions);

    const memoryContext = buildSmartMemoryContext(memories as MemoryRecord[], arcPhase);
    
    // Clear triggered memories on low signal to avoid topic jumps
    if (isLowSignal) {
      triggeredMemories.length = 0;
    }
    const triggeredPrompt = buildTriggeredMemoryPrompt(triggeredMemories);

    const continuityGuardrail = buildContextGuardrail(
      contextDebug.historyCount,
      contextDebug.memoryUsed,
      triggeredMemories.length,
    );

    let toneStrategyPrompt = `Tone strategy for this reply:\n- Strategy: ${toneStrategy.name}\n- Instruction: ${toneStrategy.instruction}`;
    
    if (isLowSignal && isEmotionalTopic) {
      toneStrategyPrompt = `Tone strategy for this reply:\n- Strategy: Low Signal Emotional\n- Instruction: User gave a quiet response like "Ahh" or "Hmm". DO NOT change the subject. Just sit with them. Say something very short like "I know...", "Take your time.", or "Yeah..."`;
    }

    const memoryHook = buildMemoryHook(memories, userEmotionSignal.label, chronological as Array<Record<string, unknown>>, arcPhase, isLowSignal);
    
    // Mood carryover context
    const moodContext = await getMoodContext(userId);
    const arcPrompt = buildArcPrompt(arcPhase, momentum, moodContext.promptText);

    // Personality prompt
    const personalityPrompt = buildPersonalityPrompt(adaptedTraits);
    
    // Stability Engine overrides
    const stabilityPrompt = buildStabilityPrompt(stabilityState, isLowSignal);

    // Behavioral Intelligence Layer
    const behaviorPrompt = await buildBehavioralOverrides(userId, message, stabilityState, adaptedTraits, isLowSignal);

    // Conversational Mode Engine (real / imagined / emotional / philosophical)
    const modeResult = await resolveConversationMode(userId, message, userEmotionSignal.label);
    const modePrompt = modeResult.prompt;

    const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\n${personalityPrompt}\n\n${memoryContext}${triggeredPrompt}${memoryHook}\n\n${continuityGuardrail}${arcPrompt}\n\n${toneStrategyPrompt}\n\n${stabilityPrompt}\n\n${behaviorPrompt}\n\n${modePrompt}`;

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
            maxOutputTokens: 150,
            temperature: 0.7,
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
            temperature: 0.7,
            max_tokens: 200,
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
            max_tokens: 100,
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

    // ── 6. Parse emotion tag & Compress ──
    const parsedEmotion = parseEmotion(rawReply);
    
    // Run structural validator + cleanup
    const preValidatedReply = validateAndFixResponse(parsedEmotion.clean, stabilityState);
    const reply = compressAndCleanReply(preValidatedReply, userEmotionSignal.label);
    
    await updateStabilityLastMode(userId, reply);
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

    const generationTimeMs = Math.round(performance.now() - startTimeMs);

    // ── 8. Log Structured ML Data ──
    const trainingLog = await TrainingInteraction.create({
      userId,
      input: message,
      predictedUserEmotion: userEmotionSignal.label,
      reply,
      replyEmotion: assistantEmotionSignal.label,
      memoryUsed: memories.length > 0,
      responseTimeMs: generationTimeMs,
    });

    return NextResponse.json({
      reply,
      emotion: assistantEmotionSignal.label,
      predictedUserEmotion: userEmotionSignal.label,
      emotionConfidence: assistantEmotionSignal.confidence,
      toneStrategy: toneStrategy.name,
      contextMessages: chronological.length,
      memoryUsed: memories.length,
      historyCount: contextDebug.historyCount,
      providerUsed,
      contextDebug,
      behavior: {
        speechRate: assistantEmotionSignal.label === "sad" ? 0.85 : assistantEmotionSignal.label === "excited" ? 1.1 : 1.0,
        pitch: assistantEmotionSignal.label === "sad" ? -2 : 0,
        avatarMood: assistantEmotionSignal.label
      },
      interactionId: String(trainingLog._id)
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
