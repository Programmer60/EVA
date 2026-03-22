import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

function buildPostRequest(payload: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it("returns 400 when message is missing", async () => {
    const route = await import("@/app/api/chat/route");

    const response = await route.POST(buildPostRequest({ userId: "u-1" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/message is required/i);
  });

  it("returns 503 when no provider keys are configured", async () => {
    const route = await import("@/app/api/chat/route");

    const response = await route.POST(buildPostRequest({
      userId: "u-1",
      message: "hello there",
    }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/missing ai provider key/i);
  });
});
