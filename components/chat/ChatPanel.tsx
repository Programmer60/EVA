"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  emotion?: string;
};

type ChatApiResponse = {
  reply: string;
  emotion?: string;
  contextMessages?: number;
  historyCount?: number;
  memoryUsed?: number;
  providerUsed?: "gemini" | "openrouter" | null;
  contextDebug?: {
    historyCount: number;
    memoryUsed: number;
    memoryCandidatesCount: number;
    memoryKeysUsed: string[];
    providerUsed: "gemini" | "openrouter" | null;
  };
};

type HistoryApiResponse = {
  messages: { role: string; content: string }[];
};

type MemoryDebugEntry = {
  key: string;
  value: string;
  importance: number;
  source: string;
  lastAccessed: string | null;
};

type MemoryDebugResponse = {
  userId: string;
  count: number;
  memories: MemoryDebugEntry[];
};

type DebugSnapshot = {
  schemaVersion: string;
  exportedAt: string;
  userId: string;
  contextDebug: ChatApiResponse["contextDebug"] | null;
  memoryFacts: MemoryDebugEntry[];
};

const USER_ID_STORAGE_KEY = "eva_user_id";

function getOrCreateUserId(): string {
  if (typeof window === "undefined") {
    return "anonymous";
  }

  const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const created = `user-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(USER_ID_STORAGE_KEY, created);
  return created;
}

export function ChatPanel() {
  const showDebugPanel = process.env.NODE_ENV !== "production";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingMemoryDebug, setIsLoadingMemoryDebug] = useState(false);
  const [isExportingSnapshot, setIsExportingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [currentEmotion, setCurrentEmotion] = useState<string>("neutral");
  const [userId, setUserId] = useState<string>("anonymous");
  const [memoryFacts, setMemoryFacts] = useState<MemoryDebugEntry[]>([]);
  const [lastContextDebug, setLastContextDebug] = useState<ChatApiResponse["contextDebug"]>();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const canSend = input.trim().length > 0 && !isLoading;

  useEffect(() => {
    const uid = getOrCreateUserId();
    setUserId(uid);

    async function loadHistory() {
      try {
        const res = await fetch(
          `/api/history?limit=20&userId=${encodeURIComponent(uid)}`,
        );
        if (!res.ok) {
          throw new Error("Could not load history.");
        }

        const data = (await res.json()) as HistoryApiResponse;
        const loaded: ChatMessage[] = data.messages.map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        }));

        if (loaded.length > 0) {
          setMessages(loaded);
        } else {
          setMessages([
            {
              role: "assistant",
              content: "Hi, I'm EVA. Tell me how you're feeling today.",
            },
          ]);
        }
      } catch {
        setMessages([
          {
            role: "assistant",
            content: "Hi, I'm EVA. Tell me how you're feeling today.",
          },
        ]);
      } finally {
        setIsLoadingHistory(false);
      }
    }

    loadHistory();
  }, []);

  useEffect(() => {
    if (!showDebugPanel || userId === "anonymous") {
      return;
    }

    async function loadMemoryDebug() {
      setIsLoadingMemoryDebug(true);
      setDebugError(null);

      try {
        const response = await fetch(
          `/api/memory?userId=${encodeURIComponent(userId)}&limit=30`,
        );
        const data = (await response.json()) as MemoryDebugResponse | { error?: string };

        if (!response.ok || !("memories" in data)) {
          const errorMessage = "error" in data ? data.error : "Could not load memory debug.";
          throw new Error(errorMessage || "Could not load memory debug.");
        }

        setMemoryFacts(data.memories);
      } catch (memoryError) {
        const messageText =
          memoryError instanceof Error ? memoryError.message : "Could not load memory debug.";
        setDebugError(messageText);
      } finally {
        setIsLoadingMemoryDebug(false);
      }
    }

    void loadMemoryDebug();
  }, [showDebugPanel, userId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const fetchAssistantReply = useCallback(async (message: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, userId }),
      });

      const data = (await response.json()) as ChatApiResponse | { error?: string };

      if (!response.ok || !("reply" in data)) {
        const errorMessage = "error" in data ? data.error : undefined;
        throw new Error(errorMessage || "Request failed.");
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.reply,
        emotion: data.emotion,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentEmotion(data.emotion ?? "neutral");
      setLastContextDebug(data.contextDebug);
      setFailedMessage(null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("eva:assistant-reply", {
            detail: {
              reply: data.reply,
              emotion: data.emotion ?? "neutral",
            },
          }),
        );
      }

      if (showDebugPanel) {
        const memoryRes = await fetch(
          `/api/memory?userId=${encodeURIComponent(userId)}&limit=30`,
        );
        const memoryData = (await memoryRes.json()) as MemoryDebugResponse | { error?: string };
        if (memoryRes.ok && "memories" in memoryData) {
          setMemoryFacts(memoryData.memories);
        }
      }
    } catch (requestError) {
      const messageText =
        requestError instanceof Error
          ? requestError.message
          : "Could not reach EVA right now.";
      setError(messageText);
      setFailedMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [showDebugPanel, userId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function onVoiceDraft(event: Event) {
      const custom = event as CustomEvent<{ message?: string }>;
      const voiceMessage = custom.detail?.message?.trim();

      if (!voiceMessage) {
        return;
      }

      setInput(voiceMessage);
      setError(null);
    }

    window.addEventListener("eva:voice-draft", onVoiceDraft as EventListener);
    return () => {
      window.removeEventListener("eva:voice-draft", onVoiceDraft as EventListener);
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const message = input.trim();
    if (!message || isLoading) return;

    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");

    await fetchAssistantReply(message);
  }

  async function retryLastMessage(): Promise<void> {
    if (!failedMessage || isLoading) return;
    await fetchAssistantReply(failedMessage);
  }

  async function refreshMemoryDebug(): Promise<void> {
    if (!showDebugPanel || !userId || userId === "anonymous") {
      return;
    }

    setIsLoadingMemoryDebug(true);
    setDebugError(null);

    try {
      const response = await fetch(
        `/api/memory?userId=${encodeURIComponent(userId)}&limit=30`,
      );

      const data = (await response.json()) as MemoryDebugResponse | { error?: string };
      if (!response.ok || !("memories" in data)) {
        const errorMessage = "error" in data ? data.error : "Could not refresh memory debug.";
        throw new Error(errorMessage || "Could not refresh memory debug.");
      }

      setMemoryFacts(data.memories);
    } catch (memoryError) {
      const messageText =
        memoryError instanceof Error ? memoryError.message : "Could not refresh memory debug.";
      setDebugError(messageText);
    } finally {
      setIsLoadingMemoryDebug(false);
    }
  }

  function downloadSnapshotFallback(payloadText: string, uid: string): void {
    const blob = new Blob([payloadText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const ts = new Date().toISOString().replace(/[.:]/g, "-");
    anchor.href = url;
    anchor.download = `eva-debug-snapshot-${uid}-${ts}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function copyDebugSnapshot(): Promise<void> {
    if (!showDebugPanel || !userId || userId === "anonymous") {
      return;
    }

    setIsExportingSnapshot(true);
    setSnapshotStatus(null);

    const payload: DebugSnapshot = {
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      userId,
      contextDebug: lastContextDebug ?? null,
      memoryFacts,
    };
    const payloadText = JSON.stringify(payload, null, 2);

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payloadText);
        setSnapshotStatus("Snapshot copied to clipboard.");
      } else {
        downloadSnapshotFallback(payloadText, userId);
        setSnapshotStatus("Clipboard unavailable. Snapshot downloaded as JSON file.");
      }
    } catch {
      downloadSnapshotFallback(payloadText, userId);
      setSnapshotStatus("Clipboard blocked. Snapshot downloaded as JSON file.");
    } finally {
      setIsExportingSnapshot(false);
    }
  }

  const emotionEmojis: Record<string, string> = {
    happy: "\u{1F60A}",
    sad: "\u{1F622}",
    angry: "\u{1F620}",
    anxious: "\u{1F630}",
    neutral: "\u{1F7E2}",
    excited: "\u{1F389}",
    curious: "\u{1F914}",
    empathetic: "\u{1F49C}",
    concerned: "\u{1F97A}",
  };

  return (
    <section className="eva-card">
      <div className="eva-section-header">
        <h2>Conversation</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {currentEmotion !== "neutral" && (
            <span className="eva-emotion-badge" title={`EVA feels: ${currentEmotion}`}>
              {emotionEmojis[currentEmotion] ?? "\u{1F7E2}"} {currentEmotion}
            </span>
          )}
          <span className="eva-pill">Live</span>
        </div>
      </div>

      <div className="eva-chat-box" id="eva-chat-scroll">
        {isLoadingHistory && (
          <div className="eva-history-loading">
            <div className="eva-skeleton" />
            <div className="eva-skeleton eva-skeleton-short" />
            <div className="eva-skeleton" />
          </div>
        )}

        {!isLoadingHistory &&
          messages.map((item, index) => (
            <p
              key={`${item.role}-${index}`}
              className={`eva-message ${item.role === "user" ? "eva-user" : "eva-assistant"}`}
            >
              <strong>{item.role === "user" ? "You" : "EVA"}</strong>
              {": "}
              {item.content}
            </p>
          ))}

        {isLoading && <p className="eva-note eva-thinking">EVA is thinking...</p>}
        <div ref={chatEndRef} />
      </div>

      <form className="eva-chat-form" onSubmit={onSubmit}>
        <label className="eva-chat-label" htmlFor="eva-message-input">
          Message
        </label>
        <div className="eva-chat-actions">
          <input
            id="eva-message-input"
            className="eva-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="How are you feeling today?"
            maxLength={1500}
            autoComplete="off"
            disabled={isLoadingHistory}
          />
          <button className="eva-btn" type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>

      {error && (
        <div className="eva-row">
          <p className="eva-error">{error}</p>
          <button
            className="eva-btn eva-btn-secondary"
            type="button"
            disabled={!failedMessage || isLoading}
            onClick={retryLastMessage}
          >
            Retry
          </button>
        </div>
      )}

      {showDebugPanel && (
        <div className="eva-debug-panel">
          <div className="eva-section-header">
            <h2>Memory Debug</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                className="eva-btn eva-btn-secondary"
                type="button"
                disabled={isLoadingMemoryDebug}
                onClick={refreshMemoryDebug}
              >
                {isLoadingMemoryDebug ? "Refreshing..." : "Refresh"}
              </button>
              <button
                className="eva-btn eva-btn-secondary"
                type="button"
                disabled={isExportingSnapshot}
                onClick={copyDebugSnapshot}
              >
                {isExportingSnapshot ? "Exporting..." : "Copy Snapshot"}
              </button>
            </div>
          </div>

          <p className="eva-note">User: {userId}</p>

          {lastContextDebug && (
            <p className="eva-note">
              Last context: history={lastContextDebug.historyCount}, memoryUsed={lastContextDebug.memoryUsed},
              candidates={lastContextDebug.memoryCandidatesCount}, provider={lastContextDebug.providerUsed ?? "n/a"}
            </p>
          )}

          {debugError && <p className="eva-error">{debugError}</p>}
          {snapshotStatus && <p className="eva-note">{snapshotStatus}</p>}

          {!debugError && memoryFacts.length === 0 && !isLoadingMemoryDebug && (
            <p className="eva-note">No memory facts stored yet.</p>
          )}

          {memoryFacts.length > 0 && (
            <div className="eva-debug-list">
              {memoryFacts.map((item, index) => (
                <p key={`${item.key}-${index}`} className="eva-debug-item">
                  <strong>{item.key}</strong>
                  {": "}
                  {item.value}
                  {" "}
                  <span className="eva-pill">{item.source}</span>
                  {" "}
                  <span className="eva-pill">importance {item.importance}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
