import { beforeEach, describe, expect, it, vi } from "vitest";

const openRouterCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn(function OpenAI() {
    return {
    chat: {
      completions: {
        create: openRouterCreate,
      },
    },
  };
  }),
}));

describe("extractTopic", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  it("uses OpenRouter when configured", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    process.env.OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
    openRouterCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "academic stress" } }],
    });

    const { extractTopic } = await import("@/lib/stability/topicExtractor");
    const topic = await extractTopic("I feel overwhelmed by exams", true);

    expect(topic).toBe("academic stress");
    expect(openRouterCreate).toHaveBeenCalledTimes(1);
    expect(openRouterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "mistralai/mistral-7b-instruct",
        temperature: 0.1,
        max_tokens: 10,
      }),
    );
  });

  it("does not use Gemini credentials for topic extraction", async () => {
    process.env.GEMINI_API_KEY = "legacy-gemini-key";

    const { extractTopic } = await import("@/lib/stability/topicExtractor");
    const topic = await extractTopic("I feel overwhelmed by exams", true);

    expect(topic).toBe("general");
    expect(openRouterCreate).not.toHaveBeenCalled();
  });
});