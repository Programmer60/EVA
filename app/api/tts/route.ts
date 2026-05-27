import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import textToSpeech from "@google-cloud/text-to-speech";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import { cacheGet, cacheSet } from "@/lib/redis";

/* ── Provider config ──────────────────────────────────────── */

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const MAX_TEXT_LENGTH = 1200;

// Google Cloud defaults
const DEFAULT_GOOGLE_VOICE = "en-US-Journey-F";
const DEFAULT_GOOGLE_LANG = "en-US";

export const runtime = "nodejs";

// Automatically uses your newly authenticated gcloud credentials
const googleTtsClient = new textToSpeech.TextToSpeechClient();

/* ── Types ────────────────────────────────────────────────── */

type TtsPayload = {
  text?: string;
  voiceId?: string;
  model?: string;
  provider?: "openai" | "google";
};

/* ── Google Cloud TTS ──────────────────────────────────────── */

async function generateGoogleTts(
  text: string,
  voiceId: string,
): Promise<Buffer> {
  try {
    const requestPayload = {
      input: { text: text },
      voice: { languageCode: DEFAULT_GOOGLE_LANG, name: voiceId },
      audioConfig: { audioEncoding: "MP3" as const },
    };

    const [response] = await googleTtsClient.synthesizeSpeech(requestPayload);
    
    if (!response.audioContent) {
      throw new Error("No audio content returned from Google Cloud TTS.");
    }
    
    // The SDK can return a base64 string or a Uint8Array depending on transport
    if (typeof response.audioContent === "string") {
      return Buffer.from(response.audioContent, "base64");
    } else {
      return Buffer.from(response.audioContent);
    }
    
  } catch (error: any) {
    logger.error("Google Cloud TTS failed", {
      error: error.message || error,
    });
    throw new AppError("Google Cloud TTS failed: " + (error.message || error), 500);
  }
}

/* ── OpenAI TTS ──────────────────────────────────────────── */

async function generateOpenAiTts(
  text: string,
  voice: string,
  model: string,
  apiKey: string,
): Promise<Buffer> {
  const client = new OpenAI({ apiKey });
  const audioResponse = await client.audio.speech.create({
    model,
    voice,
    input: text,
  });
  return Buffer.from(await audioResponse.arrayBuffer());
}

/* ── Route handler ───────────────────────────────────────── */

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as TtsPayload;
    const text = payload.text?.trim() ?? "";

    if (!text) {
      throw new AppError("Text is required.", 400);
    }

    if (text.length > MAX_TEXT_LENGTH) {
      throw new AppError("Text is too long. Max length is 1200 characters.", 413);
    }

    // Determine provider
    const requestedProvider = payload.provider?.trim() ?? "openai";
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

    // ── Redis TTS Cache Check ──
    const voiceForHash = payload.voiceId?.trim() || requestedProvider;
    const cacheKey = `tts:${createHash("sha256").update(`${text}:${voiceForHash}:${requestedProvider}`).digest("hex")}`;
    const cachedAudio = await cacheGet<string>(cacheKey);
    if (cachedAudio) {
      logger.info("TTS cache hit", { cacheKey: cacheKey.slice(0, 20) });
      return NextResponse.json(
        { audioContent: cachedAudio },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "X-Eva-Tts-Provider": "cache",
          },
        }
      );
    }

    let audioBase64: string;
    let providerUsed: string;
    let modelUsed: string;
    let voiceUsed: string;

    if (requestedProvider === "google") {
      // ── Google Cloud path ──
      voiceUsed = payload.voiceId?.trim() ||
        process.env.GOOGLE_TTS_VOICE?.trim() ||
        DEFAULT_GOOGLE_VOICE;
      modelUsed = "journey";

      logger.info("Google Cloud TTS request", { voiceId: voiceUsed, textLength: text.length });

      const audioBuffer = await generateGoogleTts(text, voiceUsed);
      audioBase64 = audioBuffer.toString("base64");
      providerUsed = "google";

    } else {
      // ── OpenAI path (default) ──
      if (!openAiApiKey) {
        throw new AppError("Missing OPENAI_API_KEY for server TTS.", 503);
      }

      modelUsed = payload.model?.trim() ||
        process.env.OPENAI_TTS_MODEL?.trim() ||
        DEFAULT_TTS_MODEL;
      voiceUsed = payload.voiceId?.trim() ||
        process.env.OPENAI_TTS_VOICE?.trim() ||
        DEFAULT_TTS_VOICE;

      logger.info("OpenAI TTS request", { voice: voiceUsed, model: modelUsed, textLength: text.length });

      const audioBuffer = await generateOpenAiTts(text, voiceUsed, modelUsed, openAiApiKey);
      audioBase64 = audioBuffer.toString("base64");
      providerUsed = "openai";
    }

    // Cache the generated audio in Redis for 24 hours
    await cacheSet(cacheKey, audioBase64, 86400);
    logger.info("TTS audio generated & cached", { provider: providerUsed, length: audioBase64.length });

    return NextResponse.json(
      { audioContent: audioBase64 },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Eva-Tts-Provider": providerUsed,
          "X-Eva-Tts-Model": modelUsed,
          "X-Eva-Tts-Voice": voiceUsed,
        },
      }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
