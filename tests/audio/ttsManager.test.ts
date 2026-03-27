import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal SpeechSynthesisUtterance stub for Node.js test environment
// ---------------------------------------------------------------------------

class SpeechSynthesisUtteranceStub {
  text: string;
  rate = 1;
  pitch = 1;
  onend: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(text = "") {
    this.text = text;
  }
}

// ---------------------------------------------------------------------------
// Helpers to mock / unmock browser speechSynthesis
// ---------------------------------------------------------------------------

function mockSpeechSynthesis(opts: { speakFails?: boolean } = {}): void {
  const speakImpl = opts.speakFails
    ? (u: SpeechSynthesisUtteranceStub) => {
        setTimeout(() => {
          if (u.onerror) {
            u.onerror({ error: "synthesis-failed" });
          }
        }, 0);
      }
    : (u: SpeechSynthesisUtteranceStub) => {
        setTimeout(() => {
          if (u.onend) {
            u.onend({});
          }
        }, 0);
      };

  Object.defineProperty(globalThis, "window", {
    value: {
      speechSynthesis: { speak: speakImpl, cancel: vi.fn() },
      SpeechSynthesisUtterance: SpeechSynthesisUtteranceStub,
    },
    writable: true,
    configurable: true,
  });
}

function removeSpeechSynthesis(): void {
  Object.defineProperty(globalThis, "window", {
    value: {},
    writable: true,
    configurable: true,
  });
}

function removeWindow(): void {
  // @ts-expect-error intentionally removing window for SSR simulation
  delete globalThis.window;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ttsManager", () => {
  beforeEach(() => {
    vi.resetModules();
    removeWindow();
  });

  describe("detectBestTtsMode", () => {
    it('returns "browser" when speechSynthesis is available', async () => {
      mockSpeechSynthesis();

      const { detectBestTtsMode } = await import("@/lib/audio/ttsManager");
      expect(detectBestTtsMode(true)).toBe("browser");
      expect(detectBestTtsMode(false)).toBe("browser");
    });

    it('returns "server" when speechSynthesis is missing and server TTS is enabled', async () => {
      removeSpeechSynthesis();

      const { detectBestTtsMode } = await import("@/lib/audio/ttsManager");
      expect(detectBestTtsMode(true)).toBe("server");
    });

    it('returns "browser" (degraded) when speechSynthesis is missing and server TTS is disabled', async () => {
      removeSpeechSynthesis();

      const { detectBestTtsMode } = await import("@/lib/audio/ttsManager");
      expect(detectBestTtsMode(false)).toBe("browser");
    });
  });

  describe("isBrowserTtsAvailable", () => {
    it("returns true when speechSynthesis and SpeechSynthesisUtterance exist", async () => {
      mockSpeechSynthesis();

      const { isBrowserTtsAvailable } = await import("@/lib/audio/ttsManager");
      expect(isBrowserTtsAvailable()).toBe(true);
    });

    it("returns false when window is undefined (SSR)", async () => {
      removeWindow();

      const { isBrowserTtsAvailable } = await import("@/lib/audio/ttsManager");
      expect(isBrowserTtsAvailable()).toBe(false);
    });

    it("returns false when speechSynthesis is missing", async () => {
      removeSpeechSynthesis();

      const { isBrowserTtsAvailable } = await import("@/lib/audio/ttsManager");
      expect(isBrowserTtsAvailable()).toBe(false);
    });
  });

  describe("speakWithFallback", () => {
    it("throws when server mode is selected but disabled", async () => {
      removeSpeechSynthesis();

      const { speakWithFallback } = await import("@/lib/audio/ttsManager");
      await expect(
        speakWithFallback("hello", {
          preferredMode: "server",
          serverTtsEnabled: false,
        }),
      ).rejects.toThrow(/server tts fallback is disabled/i);
    });

    it("throws when browser TTS is unavailable and server TTS is disabled", async () => {
      removeSpeechSynthesis();

      const { speakWithFallback } = await import("@/lib/audio/ttsManager");
      await expect(
        speakWithFallback("hello", {
          preferredMode: "browser",
          serverTtsEnabled: false,
        }),
      ).rejects.toThrow(/not available/i);
    });

    it("skips empty text without error", async () => {
      removeSpeechSynthesis();

      const { speakWithFallback } = await import("@/lib/audio/ttsManager");
      const result = await speakWithFallback("   ", {
        preferredMode: "browser",
        serverTtsEnabled: false,
      });
      expect(result).toBe("browser");
    });
  });
});
