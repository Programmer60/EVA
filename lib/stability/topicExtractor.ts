import { GoogleGenAI } from "@google/genai";
import { logger } from "@/lib/logger";

// In-memory cache for fast heuristic topic extraction (resets on server restart, good for Vercel edge/lambdas short-term memory)
const TOPIC_CACHE = new Map<string, string>();
const MAX_CACHE_SIZE = 100;

function cleanInput(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Fast Tier-1 heuristic topic extraction.
 * Extracts simple known topics based on keywords. Returns null if confidence is low.
 */
function extractHeuristicTopic(input: string): string | null {
  const text = input.toLowerCase();
  
  if (text.length > 100) return null; // Too long for simple heuristic
  
  if (text.includes("anime") || text.includes("manga") || text.includes("episode")) return "anime";
  if (text.includes("game") || text.includes("play") || text.includes("level")) return "gaming";
  if (text.includes("code") || text.includes("bug") || text.includes("error") || text.includes("programming")) return "coding";
  if (text.includes("school") || text.includes("exam") || text.includes("study") || text.includes("college")) return "academic";
  if (text.includes("mom") || text.includes("dad") || text.includes("family") || text.includes("parents")) return "family";
  if (text.includes("friend") || text.includes("lonely") || text.includes("left out")) return "friendship";

  return null;
}

/**
 * Tier-2 LLM-based topic extraction for complex/emotional narratives.
 */
async function extractLLMTopic(input: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "general"; // Fallback to general if no API key

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Extract the PRIMARY conversational topic from the user input.
Rules:
- Output ONLY 1-3 words. No punctuation.
- Focus on the emotional/theme level, not surface keywords (e.g. "trauma recovery", "academic stress", "learning struggle").

Input:
"${input}"`;

    const response = await ai.models.generateContent({
      model: "google/gemini-2.0-flash-exp:free",
      contents: prompt,
      config: {
        temperature: 0.1, // Keep it highly deterministic
        maxOutputTokens: 10,
      }
    });

    const topic = response.text?.trim().toLowerCase().replace(/[^a-z ]/g, "") || "general";
    return topic;
  } catch (error) {
    logger.error("LLM Topic Extraction failed", { error: error instanceof Error ? error.message : "Unknown error" });
    return "general";
  }
}

/**
 * Main Hybrid Topic Extractor.
 * Returns the detected topic and caches it.
 */
export async function extractTopic(input: string, isDeepPhase: boolean): Promise<string> {
  const cleaned = cleanInput(input);
  if (!cleaned) return "general";

  // Cache check
  if (TOPIC_CACHE.has(cleaned)) {
    return TOPIC_CACHE.get(cleaned)!;
  }

  let topic: string | null = null;

  // Try Heuristic if we are NOT in a deep phase (where nuance matters)
  if (!isDeepPhase) {
    topic = extractHeuristicTopic(cleaned);
  }

  // Fallback to LLM
  if (!topic) {
    topic = await extractLLMTopic(input);
  }

  // Cache it
  TOPIC_CACHE.set(cleaned, topic);
  if (TOPIC_CACHE.size > MAX_CACHE_SIZE) {
    // Very simple LRU pruning (removes oldest key since Map preserves insertion order)
    const firstKey = TOPIC_CACHE.keys().next().value;
    if (firstKey) TOPIC_CACHE.delete(firstKey);
  }

  return topic;
}
