import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function buildPostRequest(payload: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/tts", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
  });

  it("returns 503 when OPENAI_API_KEY is missing", async () => {
    const route = await import("@/app/api/tts/route");

    const response = await route.POST(buildPostRequest({ text: "Hello EVA" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/missing openai_api_key/i);
  });

  it("returns 400 when text is missing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const route = await import("@/app/api/tts/route");

    const response = await route.POST(buildPostRequest({ text: "   " }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/text is required/i);
  });
});
