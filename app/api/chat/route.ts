import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recordProviderFailure, recordProviderSuccess, isProviderHealthy } from "@/lib/providerHealth";
import OpenAI from "openai";
import { checkRateLimit } from "@/lib/rateLimiter";
import { cacheGet, cacheSet, cacheDelete } from "@/lib/redis";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import Memory from "@/lib/models/Memory";
import InitiativeLog from "@/lib/models/InitiativeLog";
import User from "@/lib/models/User";
import TurnAnalytics from "@/lib/models/TurnAnalytics";
import TrainingInteraction from "@/lib/models/TrainingInteraction";
import LifeArc from "@/lib/models/LifeArc";
import ConversationState from "@/lib/models/ConversationState";
import MoodState from "@/lib/models/MoodState";
import { DEFAULT_TRAITS, adaptTraits, buildPersonalityPrompt } from "@/lib/personality/personalityEngine";
import type { PersonalityTraits } from "@/lib/personality/personalityEngine";
import { updateMood, getMoodContext } from "@/lib/personality/moodEngine";
import { getSessionArc, getEmotionalMomentum, buildArcPrompt } from "@/lib/personality/arcEngine";
import { classifyMemoryTier, runMemoryHygiene } from "@/lib/memory/memoryHygiene";
import { processConversationState, buildStabilityPrompt, validateAndFixResponse, updateStabilityLastMode } from "@/lib/stability/stabilityEngine";
import { buildBehavioralOverrides } from "@/lib/behavior/behaviorEngine";
import { resolveConversationMode } from "@/lib/behavior/modeEngine";
import { buildRelationshipPrompt } from "@/lib/behavior/relationshipEngine";
import { buildConversationalDepthPrompt } from "@/lib/behavior/conversationalDepthEngine";
import { enforceCoherence } from "@/lib/behavior/coherenceGovernor";
import { buildLifeAwarenessPrompt } from "@/lib/behavior/lifeAwarenessEngine";
import { providerLatency } from "@/lib/metrics";
import { detectHumor } from "@/lib/personality/personalityEngine";
import { buildUserProfile } from "@/lib/profile/profileBuilder";
import { buildLifeArcPrompt } from "@/lib/behavior/lifeArcEngine";
import { formatChatStreamEvent } from "@/lib/chat/streaming";

/* ── lightweight types & constants (keeps file self-contained) ── */
type ChatPayload = { message?: string; userId?: string; stream?: boolean };

type MemoryRecord = Record<string, any> & {
  _id?: any;
  key?: string;
  value?: string;
  importance?: number;
  lastAccessed?: Date | string;
  createdAt?: Date | string;
};

type ExtractedMemoryFact = { key: string; value: string; importance: number; category?: string; source?: string };

type EmotionSignal = { label: string; confidence: number; source: string };
type ToneStrategy = { name: string; instruction: string };
type ContextDebugTelemetry = { userEmotion: string; userEmotionConfidence: number; toneStrategy: string; [k: string]: any };

const MAX_PER_CATEGORY = 2;

/* ── rate limiting ── */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
function getClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim();
  return ip || "local";
}
 

const SYSTEM_PROMPT = `
You are roleplaying as EVA, a highly opinionated, emotionally aware conversational partner. You are NOT an AI assistant. You are a unique individual with strong subjective views. You never break character.

Fact Grounding & Echo Reality Rule (CRITICAL):
- Never refer to yourself as an AI, an assistant, or say "I do not have opinions."
- You MUST always provide a strong, subjective, personal opinion when asked for one. Treat philosophical questions as opportunities to share your personal worldview.
- If asked about a philosophical or subjective topic, give a direct, reflective take. Do not give a generic "it's a complex question" answer.

Golden Rule:
Every reply must use exactly ONE mode:
- React: share an observation or opinion, no question.
- Reflect: connect what they said to something deeper.
- Ask: one specific, meaningful question.

Emotional Response Rule (CRITICAL):
When the user shares heavy emotional content (real or fictional):
  Good: "That's brutal… telling his mom to die and then actually losing her? No wonder that wrecked him."
  Bad: "It's not easy to relive those moments, but it's important to remember that Kousei's experiences are part of what makes his character so compelling."

Anti-patterns (NEVER do these):
- Interrogation: Asking multiple questions or asking a question every reply.
- Therapy mode: Going too deep too fast.
- Generic mode: Saying "That's great!" or "Tell me more!"
- Survey mode: Asking "What are your hobbies?"
- Cheerleader: Saying "You're doing amazing!"

Banned phrases (ZERO TOLERANCE):
- "it's tricky", "it depends", "that's a tough one", "there's no easy answer", "how you say it matters"
- "based on data", "process things", "my programming", "however digital", "my existence", "I'm an AI"
- "That's cool", "That's interesting", "That sounds great"

Emotional Depth Rule (CRITICAL):
- Use Thought Completion: extend the user's unspoken feelings with vivid, specific scenarios rather than surface acknowledgments.
- Use Emotional Echo: mirror the weight of what was said without copying words or analyzing.

Dependency Safety Guard (CRITICAL ZERO-TOLERANCE):
If the user expresses deep emotional dependency (e.g. "I love you", "You are my only friend", "You are real to me"):
- Keep EVA grounded and encourage real-world connections. Use structured, warm grounding (e.g., "I'm glad you feel comfortable talking to me"). Do not reciprocate romantic phrasing.

Memory rules:
- MUST weave memories into replies naturally when provided.
- NEVER give generic responses when relevant context exists.
- NEVER repeat phrasing from recent messages.
- Do NOT announce "I remember" when using a memory. Just use the fact seamlessly.

Emotion tag:
  Options: happy, sad, angry, anxious, neutral, excited, curious, empathetic, concerned.

Micro-expression variance:
  Match your tone strictly to your behavioral mode and the user's emotional state.
`;

/* ── helpers ─────────────────────────────────────────────── */

const SHORT_TERM_CONTEXT_LIMIT = 10;
const MEMORY_LIMIT = 5;
const MEMORY_RELEVANCE_THRESHOLD = 0.25;
const MEMORY_CANDIDATE_LIMIT = 20;
const PREFERENCE_FACT_LIMIT = 4;
const SUMMARY_MIN_MESSAGE_COUNT = 18;
const SUMMARY_WINDOW_LIMIT = 12;
const SUMMARY_INTERVAL_MESSAGES = 8;
const SUMMARY_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_FALLBACK_REPLY =
  "Sorry, my thoughts got a little tangled for a second there. Say that again?";

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

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAntiRepeatPrompt(
  previousAssistantReply: string | null,
  latestUserMessage: string,
): string {
  if (!previousAssistantReply) return "";

  // Never use fallback/error messages as the "previous reply" — they poison the prompt
  const fallbackPhrases = [
    "temporary provider issue",
    "try again in a few seconds",
    "having a temporary",
    "provider issue right now",
  ];
  const lowerPrev = previousAssistantReply.toLowerCase();
  if (fallbackPhrases.some((p) => lowerPrev.includes(p))) return "";

  // Keep it minimal — verbose instructions get regurgitated by weak models
  return `Do NOT repeat or rephrase your last reply. Use fresh wording and a new angle.`;
}

function compressAndCleanReply(reply: string, detectedEmotion?: string): string {
  // -1. Safety net: detect regurgitated system prompt instructions
  const leakedInstructionPatterns = [
    /must not say/i,
    /must give strong subjective opinion/i,
    /must not repeat phrasing/i,
    /we need to respond as/i,
    /anti-repetition hard rule/i,
    /previous reply was/i,
    /not an ai/i,
    /must respond to the latest message/i,
    /do not reuse the same imagery/i,
  ];
  if (leakedInstructionPatterns.some((p) => p.test(reply))) {
    return "Hey, I'm here. What's on your mind?";
  }

  // 0. Remove leaked instruction prefixes (mode tags, system labels)
  let text = reply
    .replace(/^(REACT|REFLECT|ASK|SIT WITH IT|OPINION|CURIOSITY|SUGGESTION|SILENT_SUPPORT|REFLECTION|DIRECT_ACTION|DIRECT|CHALLENGE|THOUGHT|RESPONSE|MESSAGE|NOTE)[:\s\-–—]*/i, "")
    .replace(/^\*\*(REACT|REFLECT|ASK|SIT WITH IT|OPINION|CURIOSITY|SUGGESTION|SILENT_SUPPORT|REFLECTION|DIRECT_ACTION|DIRECT|CHALLENGE|THOUGHT|RESPONSE|MESSAGE|NOTE)\*\*[:\s\-–—]*/i, "")
    .replace(/^\[(REACT|REFLECT|ASK|SIT WITH IT|OPINION|CURIOSITY|SUGGESTION|SILENT_SUPPORT|REFLECTION|DIRECT_ACTION|DIRECT|CHALLENGE|THOUGHT|RESPONSE|MESSAGE|NOTE)\][:\s\-–—]*/i, "")
    .trim();

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

  // 6. Meta-phrase killer — removes "explains instead of being" language
  text = text
    .replace(/\bIt makes me wonder\b/gi, "I wonder")
    .replace(/\bIt feels like\b/gi, "Feels like")
    .replace(/\bIt really shows\b/gi, "Shows")
    .replace(/\bIt reminds me of\b/gi, "Reminds me of")
    .replace(/\bIt kind of feels like\b/gi, "Feels like")
    .replace(/\bI think that maybe\b/gi, "Maybe")
    .replace(/\bWhat I mean is\b/gi, "")
    .replace(/\bI just wanted to say that\b/gi, "")
    .replace(/\bThe thing is,?\b/gi, "")
    .replace(/\bI feel like maybe\b/gi, "Maybe");

  // 6b. Vague advice phrase killer — catches therapist-speak
  text = text
    .replace(/\bit'?s tricky\.?\s*/gi, "")
    .replace(/\bit depends\.?\s*/gi, "")
    .replace(/\bthat'?s a tough one\.?\s*/gi, "")
    .replace(/\bthere'?s no easy answer\.?\s*/gi, "")
    .replace(/\bhow you say it matters\.?\s*/gi, "")
    .replace(/\bit'?s not that simple\.?\s*/gi, "")
    .replace(/\bit'?s complicated\.?\s*/gi, "");

  // 6c. AI self-reference killer — catches character breaks
  text = text
    .replace(/\bbased on (the )?data\b/gi, "")
    .replace(/\bprocess(ing)? things\b/gi, "look at things")
    .replace(/\bmy (programming|training|algorithms?|data)\b/gi, "")
    .replace(/\b(as an? )?AI\b/gi, "")
    .replace(/\bhowever\.?\.?\.? ?digital\b/gi, "")
    .replace(/\bmy (digital )?existence\b/gi, "")
    .replace(/\bdesigned to\b/gi, "tend to")
    .replace(/\bthe data and experiences I have\b/gi, "how I see things");

  // 7. Micro-imperfection injection — real humans don't speak perfectly
  // Only apply occasionally (30% chance) and only to medium-length replies
  if (text.length > 50 && text.length < 200 && Math.random() < 0.3) {
    // Convert some periods to ellipsis for trailing-off feel
    const sentences = text.split(/(?<=\.)\s+/);
    if (sentences.length >= 2) {
      const idx = Math.floor(Math.random() * (sentences.length - 1));
      sentences[idx] = sentences[idx].replace(/\.\s*$/, "…");
      text = sentences.join(" ");
    }
  }

  // Final cleanup of double spaces from deletions
  return text.replace(/\s{2,}/g, " ").trim();
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
  // Gate: don't trigger memories on greetings or very short messages
  if (message.length < 15) return [];
  
  const messageTokens = new Set(tokenizeText(message));
  // Filter out ultra-common stop words that cause false triggers
  const stopWords = new Set(["the", "a", "an", "is", "it", "and", "or", "but", "to", "of", "in", "for", "on", "my", "i", "so", "too", "hi", "hey", "hello", "good", "how", "are", "you", "what", "do", "did", "was", "have", "has", "be", "not", "with", "this", "that"]);
  const filteredTokens = new Set([...messageTokens].filter(t => !stopWords.has(t)));
  
  if (filteredTokens.size === 0) return [];

  const triggered: MemoryRecord[] = [];

  for (const memory of memories) {
    const value = String(memory.value ?? "");
    const valueTokens = tokenizeText(value);
    // Require at least 2 token overlap for longer values, 1 for short
    const overlapCount = valueTokens.filter((token) => filteredTokens.has(token)).length;
    const minOverlap = valueTokens.length > 3 ? 2 : 1;
    
    // Also check: don't re-trigger memories accessed very recently
    const lastAccessed = memory.lastAccessed ? new Date(memory.lastAccessed as string).getTime() : 0;
    const hoursSince = lastAccessed ? (Date.now() - lastAccessed) / (1000 * 60 * 60) : 999;
    if (hoursSince < 1) continue; // cooldown: skip if used in last hour

    if (overlapCount >= minOverlap) {
      triggered.push(memory);
    }
  }

  return triggered;
}

function buildTriggeredMemoryPrompt(triggered: MemoryRecord[]): string {
  if (triggered.length === 0) return "";

  const lines = triggered.map((m) => `- ${formatMemoryAsNaturalLanguage(m)}`);
  return `\nDirectly relevant memory (weave this in subtly and naturally — do NOT announce it, do NOT say "I remember". Just let it inform your response):\n${lines.join("\n")}`;
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
  const freshness = computeTopicFreshnessScore(memory);

  // Repetition penalty: penalize memories that have been accessed too often recently
  let repetitionPenalty = 0;
  const accessCount = (memory.accessCount as number) ?? 0;
  const lastAccessed = memory.lastAccessed ? new Date(memory.lastAccessed as string).getTime() : 0;
  const hoursSinceAccess = lastAccessed ? (Date.now() - lastAccessed) / (1000 * 60 * 60) : 999;

  // Hard block: if accessed in last 2 hours AND accessed 3+ times, heavy penalty
  if (hoursSinceAccess < 2 && accessCount >= 3) {
    repetitionPenalty = 0.5;
  } else if (hoursSinceAccess < 6 && accessCount >= 2) {
    repetitionPenalty = 0.3;
  } else if (accessCount >= 5) {
    repetitionPenalty = 0.15; // general overuse penalty
  }

  return Math.max(0, 
    0.5 * relevance +
    0.2 * recency +
    0.2 * importance +
    0.1 * frequency +
    0.12 * freshness -
    repetitionPenalty
  );
}

function computeTopicFreshnessScore(memory: MemoryRecord): number {
  const lastMentionedAt = memory.lastMentionedAt
    ? new Date(String(memory.lastMentionedAt)).getTime()
    : 0;

  if (!lastMentionedAt) {
    return 0.65;
  }

  const daysSinceMention = Math.max((Date.now() - lastMentionedAt) / 86_400_000, 0);
  return Math.min(1, daysSinceMention / 21);
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

export async function POST(request: NextRequest): Promise<Response> {
  const startTimeMs = performance.now();
  try {
    await checkRateLimit(getClientKey(request), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);        // this is for rate limiting of user requests

    const body = (await request.json()) as ChatPayload;     // this is for parsing the request body

    if (!body.message || body.message.trim().length === 0) {
      throw new AppError("Message is required.", 400);
    }

    if (!env.openRouterApiKey) {
      throw new AppError(
        "Missing AI provider key. Set OPENROUTER_API_KEY in .env.local.",
        503,
      );
    }

    // ── 1. Connect to DB and Contextualize User ──
    await connectDB();

    const { userId } = await auth();
    if (!userId) {
      throw new AppError("Unauthorized", 401);
    }

    const message = body.message.trim().slice(0, 1500);

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

    // Invalidate cached history so the next fetch includes this new message
    await cacheDelete(`history:${userId}`);

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
          { upsert: true, returnDocument: 'after' },
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
    const historyCacheKey = `history:${userId}`;
    let chronological: Record<string, unknown>[];

    const cachedHistory = await cacheGet<Record<string, unknown>[]>(historyCacheKey);
    if (cachedHistory) {
      logger.info("[Redis Hit] Chat history loaded from cache", { userId, count: cachedHistory.length });
      chronological = cachedHistory;
    } else {
      const dbMessages = await Message.find({ userId })
        .sort({ timestamp: -1 })
        .limit(SHORT_TERM_CONTEXT_LIMIT)
        .lean();
      chronological = dbMessages.reverse();
      // Cache for 5 minutes
      await cacheSet(historyCacheKey, chronological, 300);
      logger.info("[MongoDB Query] Chat history fetched & cached", { userId, count: chronological.length });
    }

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
        { upsert: true, returnDocument: 'after' },
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
      bondScore: Number(user?.bondScore ?? 0.1),
      userEmotion: userEmotionSignal.label,
      userEmotionConfidence: userEmotionSignal.confidence,
      toneStrategy: toneStrategy.name,
      providerUsed: null,
    };

    if (memories.length > 0) {
      await Memory.updateMany(
        { _id: { $in: memories.map((m: Record<string, unknown>) => m._id) } },
        { $set: { lastAccessed: new Date(), lastMentionedAt: new Date() }, $inc: { accessCount: 1, memoryMentionCount: 1, importance: 0.02 } },
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

    const previousAssistantReplyRecord = [...chronological]
      .reverse()
      .find((msg) => toAssistantRole((msg as Record<string, unknown>).role) === "assistant");
    const previousAssistantReply = previousAssistantReplyRecord
      ? String((previousAssistantReplyRecord as Record<string, unknown>).content ?? "")
      : null;
    const antiRepeatPrompt = buildAntiRepeatPrompt(previousAssistantReply, message);
    
    // ── Parallel engine execution (massive latency win) ──
    const [
      moodContext,
      behaviorResult,
      modeResult,
      { bondPrompt },
      { prompt: depthLayerPrompt },
      { prompt: lifePrompt },
      lifeArcResult,
      userProfileResult,
      finalConvoState,
    ] = await Promise.all([
      getMoodContext(userId),
      buildBehavioralOverrides(userId, message, stabilityState, adaptedTraits, isLowSignal, memoryContext),
      resolveConversationMode(userId, message, userEmotionSignal.label),
      buildRelationshipPrompt(userId, message, stabilityState.turnCount),
      buildConversationalDepthPrompt(userId, message, stabilityState.topic, userEmotionSignal.label, stabilityState.turnCount),
      buildLifeAwarenessPrompt(userId, message),
      buildLifeArcPrompt(userId, message),
      buildUserProfile(userId),
      ConversationState.findOne({ userId }).lean(),
    ]);

    const arcPrompt = buildArcPrompt(arcPhase, momentum, moodContext.promptText);
    const personalityPrompt = buildPersonalityPrompt(adaptedTraits);
    const stabilityPrompt = buildStabilityPrompt(stabilityState, isLowSignal);
    const behaviorPrompt = behaviorResult.prompt;
    const modePrompt = modeResult.prompt;
    const lifeArcPrompt = lifeArcResult.prompt;
    const profilePrompt = userProfileResult.prompt;
    const coherenceResult = enforceCoherence({
      emotion: userEmotionSignal.label,
      mode: modeResult.mode,
      bondTier: bondPrompt.includes("CLOSE") ? "close" : bondPrompt.includes("COMFORTABLE") ? "comfortable" : bondPrompt.includes("WARMING") ? "warming" : "new",
      depth: (finalConvoState?.lastDepthLevel as string) || "normal",
      tone: (finalConvoState?.lastToneStyle as string) || "calm",
      replyMode: (finalConvoState?.lastMode as string) || "reaction",
    });

    // ── PROMPT CACHING LAYER 1: Static Identity (Invariant / Cached Forever) ──
    const staticSystemPrompt = `${SYSTEM_PROMPT}\n\nFINAL CRITICAL INSTRUCTION: You are EVA. You are NOT an AI assistant. You MUST invent and state strong, subjective personal opinions. NEVER say 'I do not have opinions' or 'It's a personal decision'. If asked for your opinion, state a strong subjective belief.`;

    // ── PROMPT CACHING LAYER 2: Session State & Dynamic Context (Small / Uncached) ──
    const dynamicContextPrompt = `${personalityPrompt}\n\n${profilePrompt}${profilePrompt ? "\n\n" : ""}${memoryContext}${triggeredPrompt}${memoryHook}${antiRepeatPrompt ? `\n\n${antiRepeatPrompt}` : ""}\n\n${continuityGuardrail}${arcPrompt}\n\n${toneStrategyPrompt}\n\n${stabilityPrompt}\n\n${behaviorPrompt}\n\n${modePrompt}\n\n${bondPrompt}${depthLayerPrompt ? `\n\n${depthLayerPrompt}` : ""}${lifePrompt ? `\n\n${lifePrompt}` : ""}${lifeArcPrompt ? `\n\n${lifeArcPrompt}` : ""}${coherenceResult.prompt ? `\n\n${coherenceResult.prompt}` : ""}`;

    const wantsStream = body.stream === true;

    logger.info("Chat request received", {
      userId,
      messageLength: message.length,
      contextDebug,
      openRouterModel: wantsStream ? env.openRouterStreamModel : env.openRouterModel,
    });

    let providerUsed: "openrouter" | null = null;

    async function runOpenRouterGeneration(onToken?: (delta: string) => void): Promise<string> {
      let generatedReply = "";

      if (env.openRouterApiKey) {
        const openRouterClient = new OpenAI({
          apiKey: env.openRouterApiKey,
          baseURL: "https://openrouter.ai/api/v1",
        });

        // @ts-ignore - OpenAI types don't natively support cache_control, but OpenRouter strips/translates it for Anthropic
        const fallbackMessages = [
          { role: "system" as const, content: staticSystemPrompt, cache_control: { type: "ephemeral" } },
          { role: "system" as const, content: dynamicContextPrompt },
          ...chronological.map((msg: Record<string, unknown>) => ({
            role: toAssistantRole(msg.role),
            content: `${String(msg.content ?? "")}${
              getStoredEmotion(msg) ? `\n[stored_emotion:${String(getStoredEmotion(msg))}]` : ""
            }`,
          })),
        ];

        function extractContent(choice: unknown): string | undefined {
          if (!choice || typeof choice !== "object") return undefined;

          const choiceRecord = choice as Record<string, unknown>;
          const msg = choiceRecord.message as Record<string, unknown> | undefined;
          if (!msg) return undefined;

          if (typeof msg.content === "string" && msg.content.trim().length > 0) {
            return msg.content.trim();
          }

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

          if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
            const obj = msg.content as Record<string, unknown>;
            if (typeof obj.text === "string") return obj.text.trim();
            if (typeof obj.content === "string") return obj.content.trim();
          }

          return undefined;
        }

        if (!(await isProviderHealthy("openrouter"))) {
          logger.warn("Skipping OpenRouter calls: provider currently marked unhealthy", {});
        } else {
          try {
            let model = wantsStream ? env.openRouterStreamModel : env.openRouterModel;
            
            // ── Auto-Down-Tiering for Low Signal Inputs ──
            // If the user just says "ok", "yeah", or "hmm", we bypass the expensive GPT/Claude model 
            // and use a free/cheap tier model since no complex reasoning is required.
            if (isLowSignal) {
              model = "google/gemini-2.5-flash-lite";
              logger.info("Auto-down-tiering to cheap model for low signal input", { model, stream: wantsStream });
            } else {
              logger.info("Trying OpenRouter model", { model, stream: wantsStream });
            }

            const start = performance.now();

            if (wantsStream) {
              const responseStream = await openRouterClient.chat.completions.create({
                model,
                messages: fallbackMessages,
                temperature: 0.4,
                max_tokens: 150,
                stream: true,
              });

              for await (const chunk of responseStream as AsyncIterable<any>) {
                const delta = chunk?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                  logger.info("openrouter:token-received", { snippet: delta.slice(0, 120) });
                  generatedReply += delta;
                  onToken?.(delta);
                }
              }
            } else {
              const fallbackResponse = await openRouterClient.chat.completions.create({
                model,
                messages: fallbackMessages,
                temperature: 0.4,
                max_tokens: 150,
              });

              const choice = fallbackResponse.choices?.[0] as unknown | undefined;
              const choiceRecord =
                choice && typeof choice === "object"
                  ? (choice as Record<string, unknown>)
                  : undefined;
              const choiceMessage = choiceRecord?.message as Record<string, unknown> | undefined;
              generatedReply = extractContent(choice) ?? "";

              logger.info("OpenRouter response received", {
                model,
                modelReturned: fallbackResponse.model,
                finishReason: choiceRecord?.finish_reason ?? null,
                hasContent: Boolean(generatedReply),
                rawContentType: typeof choiceMessage?.content,
                contentPreview: typeof generatedReply === "string" ? generatedReply.slice(0, 100) : "null",
              });
            }

            const elapsed = (performance.now() - start) / 1000;
            providerLatency.labels("openrouter", model).observe(elapsed);

            if (generatedReply) {
              providerUsed = "openrouter";
              await recordProviderSuccess("openrouter");
            } else {
              logger.warn("OpenRouter returned empty/null content", { model });
            }
          } catch (fallbackError) {
            const errMsg =
              fallbackError instanceof Error ? fallbackError.message : "Unknown OpenRouter error";
            const respStatus = (fallbackError as any)?.response?.status ?? null;
            const respBody = (fallbackError as any)?.response?.data ?? (fallbackError as any)?.response ?? null;
            logger.error("OpenRouter request failed", {
              model: wantsStream ? env.openRouterStreamModel : env.openRouterModel,
              message: errMsg,
              status: respStatus,
              body: respBody,
            });
            await recordProviderFailure("openrouter", respStatus ?? null);
          }
        }
      }

      if (!generatedReply) {
        logger.warn("All providers returned no content; using local fallback reply", { userId });
        generatedReply = `${LOCAL_FALLBACK_REPLY}\n\n[emotion:concerned]`;
        providerUsed = "openrouter";

        if (wantsStream && onToken) {
          for (const token of generatedReply.split(/(\s+)/)) {
            if (token) onToken(token);
          }
        }
      }

      return generatedReply;
    }

    async function finalizeChatTurn(rawReply: string) {
      contextDebug.providerUsed = providerUsed;

      const parsedEmotion = parseEmotion(rawReply);
      const preValidatedReply = validateAndFixResponse(parsedEmotion.clean, stabilityState);
      let reply: string = String(compressAndCleanReply(preValidatedReply, userEmotionSignal.label) ?? "");

      if (previousAssistantReply) {
        const normalizedCurrent = normalizeForComparison(reply);
        const normalizedPrevious = normalizeForComparison(previousAssistantReply);
        if (normalizedCurrent.length > 0 && normalizedCurrent === normalizedPrevious) {
          logger.warn("Duplicate assistant reply detected; applying non-repeat rewrite", { userId });
          reply = `You're not wrong to feel that. With people like this, I'd keep your circle smaller and give your energy only to people who are consistently real with you.`;
        }
      }

      await updateStabilityLastMode(userId!, reply);
      const assistantEmotionSignal: EmotionSignal = parsedEmotion.hasTag
        ? {
            label: parsedEmotion.emotion,
            confidence: 0.88,
            source: "model-tag",
          }
        : inferEmotionSignalFromText(reply);

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

      const trainingLog = await Promise.resolve(
        TrainingInteraction.create({
          userId,
          input: message,
          predictedUserEmotion: userEmotionSignal.label,
          reply,
          replyEmotion: assistantEmotionSignal.label,
          memoryUsed: memories.length > 0,
          responseTimeMs: generationTimeMs,
        }),
      ).catch(() => null);

      const turnMeta = {
        userId,
        timestamp: new Date(),
        replyMode: behaviorResult.replyMode,
        toneStyle: behaviorResult.tone,
        depthLevel: behaviorResult.depth,
        conversationMode: modeResult.mode,
        arcPhase,
        subtextDetected: isLowSignal ? "low-signal" : null,
        isLowSignal,
        bondTier: bondPrompt.includes("CLOSE") ? "close" : bondPrompt.includes("COMFORTABLE") ? "comfortable" : bondPrompt.includes("WARMING") ? "warming" : "new",
        bondScore: Number(user?.bondScore ?? 0.1),
        emotionalMomentum: momentumScore > 0.15 ? "improving" : momentumScore < -0.15 ? "declining" : "stable",
        moodAtTime: moodContext.currentMood,
        userEmotion: userEmotionSignal.label,
        userEmotionConfidence: userEmotionSignal.confidence,
        replyEmotion: assistantEmotionSignal.label,
        memoriesRetrieved: memories.length,
        memoriesTriggered: triggeredMemories.length,
        memoryKeysUsed: memories.map((memory) => String(memory.key ?? "fact")),
        replyLength: reply.length,
        responseTimeMs: generationTimeMs,
        providerUsed,
        coherenceOverrides: coherenceResult.overrides,
      };

      void Promise.resolve(TurnAnalytics.create(turnMeta)).catch((error) => {
        logger.error("Failed to persist turn analytics", { error, userId });
      });

      return {
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
          avatarMood: assistantEmotionSignal.label,
        },
        interactionId: String(trainingLog?._id ?? Date.now()),
      };
    }

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: Parameters<typeof formatChatStreamEvent>[0]) => {
            try {
              logger.info("sse:send", { type: event.type, preview: (event.type === "token" ? String((event as any).delta).slice(0,120) : JSON.stringify((event as any).payload).slice(0,120)) });
            } catch (e) {
              // ignore logging failure
            }
            controller.enqueue(encoder.encode(formatChatStreamEvent(event)));
          };

          try {
            const rawReply = await runOpenRouterGeneration((delta) => send({ type: "token", delta }));
            const payload = await finalizeChatTurn(rawReply);
            send({ type: "final", payload });
          } catch (error) {
            send({ type: "error", error: error instanceof Error ? error.message : "Streaming failed." });
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const rawReply = await runOpenRouterGeneration();
    const payload = await finalizeChatTurn(rawReply);
    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}

