import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const speechCreateMock = vi.fn();
const openAiCtorMock = vi.fn((config?: unknown) => ({
  audio: {
    speech: {
      create: speechCreateMock,
    },
  },
}));

class OpenAIApiErrorMock extends Error {
  status: number;

  constructor(message = "API error", status = 500) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

class OpenAIMock {
  static APIError = OpenAIApiErrorMock;
  audio: {
    speech: {
      create: typeof speechCreateMock;
    };
  };

  constructor(config: unknown) {
    openAiCtorMock(config);
    this.audio = {
      speech: {
        create: speechCreateMock,
      },
    };
  }
}

vi.mock("openai", () => ({
  default: OpenAIMock,
}));

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
    delete process.env.OPENAI_TTS_MODEL;
    delete process.env.OPENAI_TTS_VOICE;
    speechCreateMock.mockReset();
    openAiCtorMock.mockClear();
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

  it("returns 413 when text exceeds max length", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const route = await import("@/app/api/tts/route");

    const oversizedText = "a".repeat(1201);
    const response = await route.POST(buildPostRequest({ text: oversizedText }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(413);
    expect(body.error).toMatch(/text is too long/i);
    expect(openAiCtorMock).not.toHaveBeenCalled();
  });

  it("returns audio bytes and headers on success", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE = "alloy";
    speechCreateMock.mockResolvedValue({
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    });

    const route = await import("@/app/api/tts/route");
    const response = await route.POST(buildPostRequest({ text: "Hello from EVA" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Eva-Tts-Provider")).toBe("openai");
    expect(response.headers.get("X-Eva-Tts-Model")).toBe("gpt-4o-mini-tts");
    expect(response.headers.get("X-Eva-Tts-Voice")).toBe("alloy");

    const payload = await response.arrayBuffer();
    expect(payload.byteLength).toBe(4);
    expect(speechCreateMock).toHaveBeenCalledWith({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "Hello from EVA",
    });
  });
});
