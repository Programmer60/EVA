import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";

/* ── Provider config ──────────────────────────────────────── */

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const MAX_TEXT_LENGTH = 1200;

// ElevenLabs defaults
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_ELEVENLABS_VOICE_ID = "dVTC43YenSFAlcmsISI"; // "Dhara" — warm, emotional girlfriend voice (perfect for EVA)
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
  modelId: string,
  apiKey: string,
): Promise<Buffer> {
  const url = `${ELEVENLABS_API_URL}/${voiceId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,          // balanced — not too robotic, not too variable
        similarity_boost: 0.75,  // stay close to the chosen voice character
        style: 0.3,              // subtle expressiveness — not dramatic
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    logger.error("ElevenLabs TTS request failed", {
      status: response.status,
      error: errorText.slice(0, 200),
    });
    throw new AppError(
      `ElevenLabs TTS failed: ${response.status} — ${errorText.slice(0, 100)}`,
      502,
    );
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return audioBuffer;
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

    let audioBuffer: Buffer;
    let providerUsed: string;
    let modelUsed: string;
    let voiceUsed: string;

    if (requestedProvider === "elevenlabs") {
      // ── ElevenLabs path ──
      if (!elevenLabsApiKey) {
        throw new AppError("Missing ELEVENLABS_API_KEY for ElevenLabs TTS.", 503);
      }

      voiceUsed = payload.voiceId?.trim() ||
        process.env.ELEVENLABS_VOICE_ID?.trim() ||
        DEFAULT_ELEVENLABS_VOICE_ID;
      modelUsed = payload.model?.trim() ||
        process.env.ELEVENLABS_MODEL?.trim() ||
        DEFAULT_ELEVENLABS_MODEL;

      logger.info("ElevenLabs TTS request", { voiceId: voiceUsed, model: modelUsed, textLength: text.length });

      audioBuffer = await generateElevenLabsTts(text, voiceUsed, modelUsed, elevenLabsApiKey);
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

      audioBuffer = await generateOpenAiTts(text, voiceUsed, modelUsed, openAiApiKey);
      providerUsed = "openai";
    }

    logger.info("TTS audio generated", { provider: providerUsed, bytes: audioBuffer.length });

    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Eva-Tts-Provider": providerUsed,
        "X-Eva-Tts-Model": modelUsed,
        "X-Eva-Tts-Voice": voiceUsed,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
