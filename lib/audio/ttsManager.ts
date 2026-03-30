/**
 * ttsManager — Client-side TTS helper with auto-detection and fallback chain.
 *
 * Usage (from a React component or any client module):
 *   import { detectBestTtsMode, speakWithFallback, stopAll } from "@/lib/audio/ttsManager";
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TtsMode = "browser" | "server";

export type TtsFallbackStatus =
  | "idle"
  | "speaking-browser"
  | "speaking-server"
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
 * - If browser speechSynthesis exists → "browser"
 * - Else if server TTS is enabled     → "server"
 * - Else                              → "browser" (degraded, user sees a note)
 */
export function detectBestTtsMode(serverTtsEnabled: boolean): TtsMode {
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

  // Stop server audio
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

    utterance.onend = () => {
      if (requestId === currentRequestId) {
        activeUtterance = null;
      }
      resolve();
    };

    utterance.onerror = (event) => {
      if (requestId === currentRequestId) {
        activeUtterance = null;
      }
      reject(new Error(`Browser TTS error: ${event.error ?? "unknown"}`));
    };

    window.speechSynthesis.speak(utterance);
  });
}

/* ------------------------------------------------------------------ */
/*  Server TTS                                                         */
/* ------------------------------------------------------------------ */

async function speakWithServerTts(
  text: string,
  requestId: number,
): Promise<void> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId: "alloy" }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({ error: "Server TTS request failed." }))) as {
      error?: string;
    };
    throw new Error(data.error || "Server TTS request failed.");
  }

  const audioBlob = await response.blob();

  // Check if this request was cancelled while waiting for the network response
  if (requestId !== currentRequestId) {
    return;
  }

  const objectUrl = URL.createObjectURL(audioBlob);
  activeObjectUrl = objectUrl;

  const audio = new Audio(objectUrl);
  activeAudio = audio;

  return new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      cleanUpAudio(audio, objectUrl, requestId);
      resolve();
    };

    audio.onerror = () => {
      cleanUpAudio(audio, objectUrl, requestId);
      reject(new Error("Could not play server TTS audio."));
    };

    audio.play().catch((err) => {
      cleanUpAudio(audio, objectUrl, requestId);
      reject(err instanceof Error ? err : new Error("Audio playback failed."));
    });
  });
}

function cleanUpAudio(audio: HTMLAudioElement, objectUrl: string, requestId: number): void {
  if (activeObjectUrl === objectUrl) {
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
 * is "browser" and it fails, automatically retry with server TTS (if enabled).
 *
 * Returns the mode that was ultimately used (useful for UI status display).
 */
export async function speakWithFallback(
  text: string,
  options: {
    preferredMode: TtsMode;
    serverTtsEnabled: boolean;
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

  // ---- Server-preferred path ----
  if (preferredMode === "server") {
    if (!serverTtsEnabled) {
      callbacks?.onStatusChange?.("error", "Server TTS is disabled.");
      throw new Error("Server TTS fallback is disabled.");
    }

    callbacks?.onStatusChange?.("speaking-server");
    try {
      await speakWithServerTts(clean, requestId);
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
        await speakWithServerTts(clean, requestId);
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
