import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { AppError, toErrorResponse } from "@/lib/errors";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_STT_MODEL = "whisper-1";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError("Missing OPENAI_API_KEY for server STT.", 503);
    }

    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      throw new AppError("Audio file is required.", 400);
    }

    if (audio.size <= 0) {
      throw new AppError("Audio file is empty.", 400);
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      throw new AppError("Audio file is too large. Max size is 10MB.", 413);
    }

    const client = new OpenAI({ apiKey });
    const transcription = await client.audio.transcriptions.create({
      model: DEFAULT_STT_MODEL,
      file: audio,
      response_format: "json",
      temperature: 0,
    });

    const text = (transcription.text ?? "").trim();
    if (!text) {
      throw new AppError("No speech detected in audio.", 422);
    }

    return NextResponse.json({
      text,
      provider: "openai",
      model: DEFAULT_STT_MODEL,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
