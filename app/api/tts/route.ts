import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import { cacheGet, cacheSet } from "@/lib/redis";

/* ── Provider config ──────────────────────────────────────── */

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const MAX_TEXT_LENGTH = 1200;


// ElevenLabs defaults — "Rachel" voice (warm, calm female voice)
const DEFAULT_ELEVENLABS_VOICE = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";

export const runtime = "nodejs";



/* ── Types ────────────────────────────────────────────────── */

type TtsPayload = {
  text?: string;
  voiceId?: string;
  model?: string;
  provider?: "openai" | "elevenlabs";
};

/* ── ElevenLabs TTS ──────────────────────────────────────── */

async function generateElevenLabsTts(
  text: string,
  voiceId: string,
  model: string,
  apiKey: string,
): Promise<Buffer> {
  const client = new ElevenLabsClient({ apiKey });

  const audioStream = await client.textToSpeech.convert(voiceId, {
    text,
    model_id: model,
    output_format: "mp3_44100_128",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.2,
      use_speaker_boost: true,
    },
  });

  // Collect all chunks from the stream into a buffer
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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

    if (requestedProvider === "elevenlabs") {
      // ── ElevenLabs path ──
      if (!elevenLabsApiKey) {
        throw new AppError("Missing ELEVENLABS_API_KEY.", 503);
      }

      voiceUsed = payload.voiceId?.trim() ||
        process.env.ELEVENLABS_VOICE_ID?.trim() ||
        DEFAULT_ELEVENLABS_VOICE;
      modelUsed = payload.model?.trim() ||
        process.env.ELEVENLABS_MODEL?.trim() ||
        DEFAULT_ELEVENLABS_MODEL;

      logger.info("ElevenLabs TTS request", { voiceId: voiceUsed, model: modelUsed, textLength: text.length });

      const audioBuffer = await generateElevenLabsTts(text, voiceUsed, modelUsed, elevenLabsApiKey);
      audioBase64 = audioBuffer.toString("base64");
      providerUsed = "elevenlabs";

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
