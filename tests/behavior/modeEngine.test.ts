import { describe, it, expect } from "vitest";
import { chooseReplyMode, ModeResult } from "@/lib/behavior/modeEngine";

describe("chooseReplyMode heuristics", () => {
  it("returns opinion for explicit opinion questions", () => {
    const res: ModeResult = { mode: "real", scene: null, momentum: 1, prompt: "" };
    expect(chooseReplyMode("What do you think I should do here?", res)).toBe("opinion");
    expect(chooseReplyMode("What would you do in my place?", res)).toBe("opinion");
  });

  it("returns opinion for awkwardness signals", () => {
    const res: ModeResult = { mode: "real", scene: null, momentum: 1, prompt: "" };
    expect(chooseReplyMode("I'm nervous about saying hello, is that weird or awkward?", res)).toBe("opinion");
    expect(chooseReplyMode("Do people overestimate how awkward a simple hello is?", res)).toBe("opinion");
  });

  it("does not return opinion for neutral factual queries", () => {
    const res: ModeResult = { mode: "real", scene: null, momentum: 1, prompt: "" };
    expect(chooseReplyMode("What's the weather today?", res)).toBeUndefined();
    expect(chooseReplyMode("How do I install Node.js?", res)).toBeUndefined();
  });

  it("respects emotional mode and is conservative", () => {
    const res: ModeResult = { mode: "emotional", scene: null, momentum: 2, prompt: "" };
    // In emotional mode, only explicit opinion asks should trigger
    expect(chooseReplyMode("I'm really sad, what do you think?", res)).toBe("opinion");
    expect(chooseReplyMode("I feel like crying and don't know why", res)).toBeUndefined();
  });
});
