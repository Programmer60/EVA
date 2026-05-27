import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Top-level stubs so Vitest hoisting/mocking works predictably
const createMock = vi.fn();

vi.mock("@/lib/mongodb", () => ({ connectDB: vi.fn() }));
vi.mock("@/lib/metrics", () => ({
  providerLatency: { observe: vi.fn() },
  providerFailureCounter: { inc: vi.fn() },
  providerErrorCounter: { inc: vi.fn() },
  providerSuccessCounter: { inc: vi.fn() },
  register: { clear: vi.fn() },
}));
vi.mock("@/lib/providerHealth", () => ({
  recordProviderFailure: vi.fn(),
  recordProviderSuccess: vi.fn(),
  isProviderHealthy: vi.fn().mockResolvedValue(true),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-fallback" }),
}));

class QueryStub {
  value: any;
  constructor(value: any) {
    this.value = value;
  }
  lean() {
    return this;
  }
  sort() {
    return this;
  }
  limit() {
    return this;
  }
  skip() {
    return this;
  }
  exec() {
    return Promise.resolve(this.value);
  }
  then(onFulfilled: any) {
    return Promise.resolve(this.value).then(onFulfilled);
  }
}

const defaultFindOneResult = {
  turnCount: 0,
  shortTerm: [],
  summary: null,
  lastUpdated: new Date(),
};

const noopModel = {
  create: vi.fn(),
  find: vi.fn(() => new QueryStub([])),
  findOne: vi.fn(() => new QueryStub(defaultFindOneResult)),
  updateMany: vi.fn().mockResolvedValue({}),
  updateOne: vi.fn().mockResolvedValue({}),
  findOneAndUpdate: vi.fn().mockResolvedValue(null),
  findById: vi.fn().mockResolvedValue(null),
  findByIdAndUpdate: vi.fn().mockResolvedValue(null),
  deleteMany: vi.fn().mockResolvedValue({}),
  countDocuments: vi.fn().mockResolvedValue(0),
  aggregate: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/models/Message", () => ({ default: noopModel }));
vi.mock("@/lib/models/Memory", () => ({ default: noopModel }));
vi.mock("@/lib/models/InitiativeLog", () => ({ default: noopModel }));
vi.mock("@/lib/models/User", () => ({ default: noopModel }));
vi.mock("@/lib/models/TurnAnalytics", () => ({ default: noopModel }));
vi.mock("@/lib/models/TrainingInteraction", () => ({ default: noopModel }));
vi.mock("@/lib/models/LifeArc", () => ({ default: noopModel }));
vi.mock("@/lib/models/ConversationState", () => ({ default: noopModel }));
vi.mock("@/lib/models/MoodState", () => ({ default: noopModel }));

vi.mock("openai", () => {
  class APIError extends Error {}
  const defaultFn = vi.fn(function OpenAI() {
    return { chat: { completions: { create: createMock } } };
  });
  // Attach APIError to the default export so `OpenAI.APIError` checks work
  (defaultFn as any).APIError = APIError;
  return { default: defaultFn };
});

function buildPostRequest(payload: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/chat fallback behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it("falls back to local reply when OpenRouter errors", async () => {
    process.env.OPENROUTER_API_KEY = "ok";

    // Configure top-level OpenAI mock to fail
    createMock.mockReset();
    createMock.mockRejectedValue(new Error("boom"));

    const route = await import("@/app/api/chat/route");
    const res = await route.POST(buildPostRequest({ userId: "u-fallback", message: "test fallback" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toMatch(/temporary provider issue/i);
    expect(body.providerUsed === null || body.providerUsed === "openrouter").toBeTruthy();
  }, 20000);
});
