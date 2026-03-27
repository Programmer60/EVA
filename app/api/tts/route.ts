import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { AppError, toErrorResponse } from "@/lib/errors";

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const MAX_TEXT_LENGTH = 1200;

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError("Missing OPENAI_API_KEY for server TTS.", 503);
    }

    const payload = (await request.json()) as { text?: string; voiceId?: string; model?: string };
    const text = payload.text?.trim() ?? "";

    if (!text) {
      throw new AppError("Text is required.", 400);
    }

    if (text.length > MAX_TEXT_LENGTH) {
      throw new AppError("Text is too long. Max length is 1200 characters.", 413);
    }

    const model = payload.model?.trim() || process.env.OPENAI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
    const voice = payload.voiceId?.trim() || process.env.OPENAI_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;

    const client = new OpenAI({ apiKey });
    const audioResponse = await client.audio.speech.create({
      model,
      voice,
      input: text,
    });

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Eva-Tts-Provider": "openai",
        "X-Eva-Tts-Model": model,
        "X-Eva-Tts-Voice": voice,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
