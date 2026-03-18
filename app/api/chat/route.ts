import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import OpenAI from "openai";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import User from "@/lib/models/User";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatPayload = {
  message?: string;
  userId?: string;
  history?: ChatMessage[];
};

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

function sanitizeHistory(history: ChatMessage[] | undefined): ChatMessage[] {
  if (!history) {
    return [];
  }

  return history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 1500) }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    enforceRateLimit(request);

    const body = (await request.json()) as ChatPayload;

    if (!body.message || body.message.trim().length === 0) {
      throw new AppError("Message is required.", 400);
    }

    if (!env.openAiApiKey) {
      throw new AppError(
        "OPENAI_API_KEY is missing. Add it to .env.local and restart dev server.",
        503,
      );
    }

    // Connect to database
    await connectDB();

    const message = body.message.trim().slice(0, 1500);
    const userId = body.userId ?? "anonymous";
    const history = sanitizeHistory(body.history);
    const client = new OpenAI({ apiKey: env.openAiApiKey });

    logger.info("Chat request received", {
      userId,
      messageLength: message.length,
      historyItems: history.length,
      model: env.openAiModel,
    });

    // Save user message to database
    await Message.create({
      userId,
      role: "user",
      content: message,
    });

    const input = [
      {
        role: "system" as const,
        content:
          "You are EVA, an emotionally aware assistant. Respond naturally, with empathy and clear, concise guidance.",
      },
      ...history,
      {
        role: "user" as const,
        content: message,
      },
    ];

    const response = await client.responses.create({
      model: env.openAiModel,
      input,
      max_output_tokens: 300,
      temperature: 0.7,
    });

    const reply = response.output_text?.trim();

    if (!reply) {
      throw new AppError("Model did not return a reply.", 502);
    }

    // Save assistant message to database
    await Message.create({
      userId,
      role: "eva",
      content: reply,
    });

    return NextResponse.json({
      reply,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
