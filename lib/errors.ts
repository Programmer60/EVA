import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import OpenAI from "openai";

export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof OpenAI.APIError) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }

  logger.error("Unhandled API error", {
    error: error instanceof Error ? error.message : "Unknown error",
  });

  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
