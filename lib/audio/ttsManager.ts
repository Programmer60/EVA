/**
 * ttsManager — Client-side TTS helper with auto-detection and fallback chain.
 *
 * Supports three modes:
 *   - "browser"     — Free, uses native speechSynthesis
 *   - "server"      — OpenAI TTS via /api/tts
 *   - "google"      — Google Cloud TTS via /api/tts (premium, Journey voice)
 *
 * Usage (from a React component or any client module):
 *   import { detectBestTtsMode, speakWithFallback, stopAll } from "@/lib/audio/ttsManager";
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TtsMode = "browser" | "server" | "google";

export type TtsFallbackStatus =
  | "idle"
  | "speaking-browser"
  | "speaking-server"
  | "speaking-google"
  | "fallback-activated"
  | "error";

export interface TtsCallbacks {
  onStatusChange?: (status: TtsFallbackStatus, detail?: string) => void;
}

export type VoiceBehavior = {
  speechRate?: number;
  pitch?: number;
};

/* ------------------------------------------------------------------ */
/*  Module-level state (singleton per page)                            */
/* ------------------------------------------------------------------ */

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let currentRequestId = 0;

/* ------------------------------------------------------------------ */
/*  Avatar event helpers                                               */
/* ------------------------------------------------------------------ */

function emitAvatarEvent(name: string, detail?: Record<string, unknown>): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/* ------------------------------------------------------------------ */
/*  Capability detection                                               */
/* ------------------------------------------------------------------ */

export function isBrowserTtsAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * Pick the best initial TTS mode.
 *
 * Priority: ElevenLabs (if enabled) > Server (if enabled) > Browser
 */
export function detectBestTtsMode(
  serverTtsEnabled: boolean,
  googleEnabled?: boolean,
): TtsMode {
  if (googleEnabled) {
    return "google";
  }

  if (isBrowserTtsAvailable()) {
    return "browser";
  }

  return serverTtsEnabled ? "server" : "browser";
}

/* ------------------------------------------------------------------ */
/*  Stop helpers                                                       */
/* ------------------------------------------------------------------ */

export function stopAll(): void {
  currentRequestId += 1;

  // Stop browser TTS
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;

  // Stop server audio (works for both OpenAI and ElevenLabs)
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Browser TTS                                                        */
/* ------------------------------------------------------------------ */

function speakWithBrowserTts(
  text: string,
  requestId: number,
  behavior?: VoiceBehavior
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isBrowserTtsAvailable()) {
      reject(new Error("Browser speechSynthesis is not available."));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = behavior?.speechRate ?? 1;
    utterance.pitch = behavior?.pitch !== undefined 
      ? 1 + (behavior.pitch * 0.1) // typical pitch range is 0-2 (default 1). If we pass -2, it becomes 0.8
      : 1;
    activeUtterance = utterance;

    utterance.onstart = () => {
      emitAvatarEvent("eva:tts-start", { mode: "browser" });
    };

    // Word boundary events drive lip sync simulation
    utterance.onboundary = () => {
      emitAvatarEvent("eva:tts-word-boundary");
    };

    utterance.onend = () => {
      if (requestId === currentRequestId) {
        activeUtterance = null;
      }
      emitAvatarEvent("eva:tts-end");
      resolve();
    };

    utterance.onerror = (event) => {
      if (requestId === currentRequestId) {
        activeUtterance = null;
      }
      emitAvatarEvent("eva:tts-end");
      reject(new Error(`Browser TTS error: ${event.error ?? "unknown"}`));
    };

    window.speechSynthesis.speak(utterance);
  });
}

/* ------------------------------------------------------------------ */
/*  Server TTS (OpenAI or ElevenLabs — both go through /api/tts)       */
/* ------------------------------------------------------------------ */

async function speakWithServerProvider(
  text: string,
  requestId: number,
  provider: "openai" | "google",
): Promise<void> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      provider,
      ...(provider === "openai" ? { voiceId: "alloy" } : {}),
    }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({ error: "Server TTS request failed." }))) as {
      error?: string;
    };
    throw new Error(data.error || `${provider} TTS request failed.`);
  }

  const data = await response.json() as { audioContent?: string };

  // Check if this request was cancelled while waiting for the network response
  if (requestId !== currentRequestId) {
    return;
  }

  if (!data.audioContent) {
    throw new Error(`Invalid response format from ${provider} TTS.`);
  }

  activeObjectUrl = null; // We are no longer using Object URLs
  activeAudio = null;

  return new Promise<void>((resolve, reject) => {
    // Listen for the tts-end event that LipSyncAnalyzer will dispatch when playback finishes
    const onEnd = () => {
      window.removeEventListener("eva:tts-end", onEnd);
      resolve();
    };
    window.addEventListener("eva:tts-end", onEnd);

    // Emit TTS start with the raw base64 string for the analyzer to decode and play
    emitAvatarEvent("eva:tts-start", { 
      mode: provider === "google" ? "server" : "server", 
      base64Audio: data.audioContent 
    });
  });
}

function cleanUpAudio(audio: HTMLAudioElement | null, objectUrl: string, requestId: number): void {
  if (activeObjectUrl === objectUrl && objectUrl) {
    URL.revokeObjectURL(objectUrl);
    activeObjectUrl = null;
  }
  if (activeAudio === audio && requestId === currentRequestId) {
    activeAudio = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main entry — speak with automatic fallback                         */
/* ------------------------------------------------------------------ */

/**
 * Try to speak `text` using the user's preferred mode. If the preferred mode
 * fails, automatically try fallback providers.
 *
 * Fallback chain:
 *   google     → server → browser
 *   server     → browser
 *   browser    → server (if enabled)
 *
 * Returns the mode that was ultimately used (useful for UI status display).
 */
export async function speakWithFallback(
  text: string,
  options: {
    preferredMode: TtsMode;
    serverTtsEnabled: boolean;
    googleEnabled?: boolean;
    callbacks?: TtsCallbacks;
    behavior?: VoiceBehavior;
  },
): Promise<TtsMode> {
  const { preferredMode, serverTtsEnabled, callbacks, behavior } = options;
  const clean = text.trim();
  if (!clean) {
    return preferredMode;
  }

  stopAll();
  const requestId = currentRequestId;

  // ---- Google-preferred path ----
  if (preferredMode === "google") {
    callbacks?.onStatusChange?.("speaking-google");
    try {
      await speakWithServerProvider(clean, requestId, "google");
      callbacks?.onStatusChange?.("idle");
      return "google";
    } catch (err) {
      // Fallback to server if available
      if (serverTtsEnabled) {
        callbacks?.onStatusChange?.(
          "fallback-activated",
          "Google Cloud TTS failed — falling back to server TTS.",
        );
        try {
          const fallbackProvider = options.googleEnabled ? "google" : "openai";
          await speakWithServerProvider(clean, requestId, fallbackProvider);
          callbacks?.onStatusChange?.("idle");
          return "server";
        } catch {
          // Fall through to browser
        }
      }
      // Fallback to browser
      if (isBrowserTtsAvailable()) {
        callbacks?.onStatusChange?.(
          "fallback-activated",
          "Google Cloud TTS failed — falling back to browser TTS.",
        );
        try {
          await speakWithBrowserTts(clean, requestId, behavior);
          callbacks?.onStatusChange?.("idle");
          return "browser";
        } catch {
          // All failed
        }
      }
      callbacks?.onStatusChange?.("error", err instanceof Error ? err.message : "Google Cloud TTS failed.");
      throw err;
    }
  }

  // ---- Server-preferred path ----
  if (preferredMode === "server") {
    if (!serverTtsEnabled) {
      callbacks?.onStatusChange?.("error", "Server TTS is disabled.");
      throw new Error("Server TTS fallback is disabled.");
    }

    callbacks?.onStatusChange?.("speaking-server");
    try {
      const serverProvider = options.googleEnabled ? "google" : "openai";
      await speakWithServerProvider(clean, requestId, serverProvider);
      callbacks?.onStatusChange?.("idle");
      return "server";
    } catch (err) {
      callbacks?.onStatusChange?.("error", err instanceof Error ? err.message : "Server TTS failed.");
      throw err;
    }
  }

  // ---- Browser-preferred path with auto-fallback ----
  callbacks?.onStatusChange?.("speaking-browser");
  try {
    await speakWithBrowserTts(clean, requestId, behavior);
    callbacks?.onStatusChange?.("idle");
    return "browser";
  } catch (browserError) {
    // Browser TTS failed — try server fallback if enabled
    if (serverTtsEnabled) {
      callbacks?.onStatusChange?.(
        "fallback-activated",
        "Browser TTS failed — switching to server fallback.",
      );
      try {
        const fallbackProvider = options.googleEnabled ? "google" : "openai";
        await speakWithServerProvider(clean, requestId, fallbackProvider);
        callbacks?.onStatusChange?.("idle");
        return "server";
      } catch (serverError) {
        callbacks?.onStatusChange?.(
          "error",
          serverError instanceof Error ? serverError.message : "Server TTS fallback also failed.",
        );
        throw serverError;
      }
    }

    // No server fallback available
    callbacks?.onStatusChange?.(
      "error",
      browserError instanceof Error ? browserError.message : "Browser TTS failed.",
    );
    throw browserError;
  }
}
