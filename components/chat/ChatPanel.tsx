"use client";

import { Brain, FileText, Download, X, Bot, RefreshCw } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { initSharedAudioContext } from "@/lib/avatar/lipSyncAnalyzer";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getTypingDelay, chunkReply, presenceSleep } from "@/lib/presence/presenceEngine";
import { consumeChatStream } from "@/lib/chat/streaming";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  emotion?: string;
  interactionId?: string;
  feedbackGiven?: boolean;
};

type ChatApiResponse = {
  reply: string;
  emotion?: string;
  predictedUserEmotion?: string;
  contextMessages?: number;
  historyCount?: number;
  memoryUsed?: number;
  providerUsed?: "openrouter" | null;
  contextDebug?: {
    historyCount: number;
    memoryUsed: number;
    memoryCandidatesCount: number;
    memoryKeysUsed: string[];
    providerUsed: "openrouter" | null;
    bondScore?: number;
  };
  behavior?: {
    speechRate: number;
    pitch: number;
    avatarMood: string;
  };
  interactionId?: string;
};

type HistoryApiResponse = {
  messages: { role: string; content: string }[];
};

type MemoryDebugEntry = {
  id: string;
  key: string;
  value: string;
  importance: number;
  source: string;
  lastAccessed: string | null;
  memoryMentionCount?: number;
  lastMentionedAt?: string | null;
};

type MemoryDebugResponse = {
  userId: string;
  count: number;
  profile?: {
    userId: string;
    bondTier: string;
    bondScore: number;
    dominantEmotion: string;
    dominantReplyMode: string;
    dominantTone: string;
    activeArcs: number;
    recurringTopics: string[];
    recentMemories: string[];
    observedPatterns: string[];
    summary: string;
  } | null;
  memories: MemoryDebugEntry[];
};

type DebugSnapshot = {
  schemaVersion: string;
  exportedAt: string;
  userId: string;
  contextDebug: ChatApiResponse["contextDebug"] | null;
  memoryFacts: MemoryDebugEntry[];
};

function formatProfileNameFromUserId(userId: string): string {
  if (!userId || userId === "anonymous") {
    return "Anonymous";
  }

  const userPrefixMatch = userId.match(/^user-(.+)$/i);
  return userPrefixMatch?.[1] ?? userId;
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
  const { userId } = useAuth();
  const [profileName, setProfileName] = useState<string>("Anonymous");
  const [memoryFacts, setMemoryFacts] = useState<MemoryDebugEntry[]>([]);
  const [memoryProfile, setMemoryProfile] = useState<MemoryDebugResponse["profile"]>(null);
  const [lastContextDebug, setLastContextDebug] = useState<ChatApiResponse["contextDebug"]>();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  
  // Temporal Activity Timers
  const lastActivityRef = useRef<number>(Date.now());
  const hasTriggeredInitiative = useRef<boolean>(false);
  const pendingInitiativeRef = useRef<boolean>(false);

  // Presence Layer State
  type PresencePhase = "idle" | "thinking" | "streaming" | "interrupted";
  const [presencePhase, setPresencePhase] = useState<PresencePhase>("idle");
  const [streamingContent, setStreamingContent] = useState<string>("");
  const streamAbortRef = useRef<AbortController | null>(null);

  const canSend = input.trim().length > 0 && !isLoading && presencePhase === "idle";

  async function handleFeedback(interactionId: string, msgIndex: number, score: number, overrideEmotion?: string) {
    try {
      const payload: Record<string, any> = { interactionId };
      if (score !== 0) payload.feedbackScore = score;
      if (overrideEmotion) payload.actualUserEmotion = overrideEmotion;

      await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      // Mark feedback as given so UI can hide the buttons
      setMessages(prev => {
        const updated = [...prev];
        if (updated[msgIndex]) {
          updated[msgIndex].feedbackGiven = true;
        }
        return updated;
      });
    } catch {
      // silently fail feedback logging if network errors 
    }
  }

  const triggerProactiveGreeting = useCallback(async (uid: string) => {
    if (hasTriggeredInitiative.current) return;
    hasTriggeredInitiative.current = true;
    setIsLoading(true);
    try {
      const res = await fetch("/api/chat/initiative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
      const d = await res.json();

      // Scoring engine returned "silence" — EVA chose not to speak
      if (d.action === "silence") {
        console.log("[EVA Initiative] Silence decision", { score: d.score, breakdown: d.breakdown });
        hasTriggeredInitiative.current = false; // allow future triggers
        return;
      }

      if (d.reply) {
        pendingInitiativeRef.current = true; // track that we're awaiting user response
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: d.reply, emotion: d.emotion ?? "happy" },
        ]);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("eva:assistant-reply", {
              detail: { reply: d.reply, emotion: d.emotion ?? "happy" },
            }),
          );
        }
      }
    } catch (e) {
      console.error("Initiative failed", e);
      hasTriggeredInitiative.current = false;
    } finally {
      setIsLoading(false);
      lastActivityRef.current = Date.now();
    }
  }, []);

  // Auto-fetch history on mount
  useEffect(() => {
    async function fetchHistory() {
      setIsLoadingHistory(true);
      setError(null);

      // Wait for auth to hydrate
      if (!userId) {
        setIsLoadingHistory(false);
        return;
      }
      
      setProfileName(formatProfileNameFromUserId(userId));

      try {
        const res = await fetch(`/api/history?limit=20&userId=${encodeURIComponent(userId)}`);
        if (!res.ok) {
          throw new Error("Could not load history.");
        }

        const data = (await res.json()) as HistoryApiResponse;
        const loaded: ChatMessage[] = data.messages.map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        }));

        let shouldTriggerInitiative = false;
        if (loaded.length > 0) {
          setMessages(loaded);
          const lastMsg: any = data.messages[data.messages.length - 1];
          if (lastMsg && lastMsg.timestamp) {
            lastActivityRef.current = new Date(lastMsg.timestamp).getTime();
            const diffMs = Date.now() - lastActivityRef.current;
            if (diffMs > 6 * 60 * 60 * 1000) { // 6 HOURS THRESHOLD
              shouldTriggerInitiative = true;
            }
          }
        } else {
          setMessages([]);
          shouldTriggerInitiative = true;
        }

        if (shouldTriggerInitiative) {
          void triggerProactiveGreeting(userId);
        }

      } catch {
        setMessages([{ role: "assistant", content: "Hi, I'm EVA. Tell me how you're feeling today." }]);
      } finally {
        setIsLoadingHistory(false);
      }
    }

    fetchHistory();
  }, [triggerProactiveGreeting, userId]);

  // Polling Effect for Inactivity
  useEffect(() => {
    if (!userId || isLoadingHistory || isLoading) return;

    const timer = setInterval(() => {
      if (hasTriggeredInitiative.current) return;
      const diffMs = Date.now() - lastActivityRef.current;
      if (diffMs > 6 * 60 * 60 * 1000) { // 6 HOURS THRESHOLD
        void triggerProactiveGreeting(userId);
      }
    }, 10000);

    return () => clearInterval(timer);
  }, [userId, isLoadingHistory, isLoading, triggerProactiveGreeting]);

  useEffect(() => {
    if (!showDebugPanel || !userId) {
      return;
    }

    async function loadMemoryDebug() {
      setIsLoadingMemoryDebug(true);
      setDebugError(null);

      try {
        const response = await fetch(
          `/api/memory?userId=${encodeURIComponent(userId as string)}&limit=30&includeProfile=true`,
        );
        const data = (await response.json()) as MemoryDebugResponse | { error?: string };

        if (!response.ok || !("memories" in data)) {
          const errorMessage = "error" in data ? data.error : "Could not load memory debug.";
          throw new Error(errorMessage || "Could not load memory debug.");
        }

        setMemoryFacts(data.memories);
        setMemoryProfile("profile" in data ? data.profile ?? null : null);
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
    const box = chatBoxRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [messages, isLoading, streamingContent, presencePhase]);

  const fetchAssistantReply = useCallback(async (message: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    lastActivityRef.current = Date.now();
    hasTriggeredInitiative.current = false;

    // If user is responding after a proactive initiative, mark it as responded
    if (pendingInitiativeRef.current && userId !== "anonymous") {
      pendingInitiativeRef.current = false;
      fetch("/api/chat/initiative/respond", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }).catch(() => { /* silent */ });
    }

    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    const timeoutId = window.setTimeout(() => abortController.abort(), 45000);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, userId, stream: true }),
        signal: abortController.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorData?.error || "Request failed.");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        let streamStarted = false;
        const finalData = (await consumeChatStream(response, {
          onToken: (delta) => {
            if (!streamStarted) {
              streamStarted = true;
              setPresencePhase("streaming");
              emitPresenceChange("streaming");
              setIsLoading(false);
            }
            setStreamingContent((prev) => prev + delta);
          },
        })) as ChatApiResponse;

        const replyText = finalData.reply;
        const replyEmotion = finalData.emotion ?? "neutral";

        setCurrentEmotion(replyEmotion);
        if (finalData.contextDebug) setLastContextDebug(finalData.contextDebug as ChatApiResponse["contextDebug"]);
        setFailedMessage(null);
        setIsLoading(false);

        if (!streamStarted) {
          setPresencePhase("streaming");
          emitPresenceChange("streaming");
        }

        setStreamingContent("");
        setPresencePhase("idle");
        emitPresenceChange("idle");
        streamAbortRef.current = null;

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: replyText,
            emotion: finalData.predictedUserEmotion ?? replyEmotion,
            interactionId: finalData.interactionId,
          },
        ]);

        lastActivityRef.current = Date.now();
        emitTtsEvent(replyText, replyEmotion, finalData.behavior);

      if (showDebugPanel) {
        const memoryRes = await fetch(
          `/api/memory?userId=${encodeURIComponent(userId as string)}&limit=30`,
        );
        const memoryData = (await memoryRes.json()) as MemoryDebugResponse | { error?: string };
        if (memoryRes.ok && "memories" in memoryData) {
          setMemoryFacts(memoryData.memories);
        }
      }
      } else {
        const data = (await response.json()) as ChatApiResponse | { error?: string };

        if (!("reply" in data)) {
          const errorMessage = "error" in data ? data.error : undefined;
          throw new Error(errorMessage || "Request failed.");
        }

        const replyText = data.reply;
        const replyEmotion = data.emotion ?? "neutral";

        setCurrentEmotion(replyEmotion);
        if (data.contextDebug) setLastContextDebug(data.contextDebug);
        setFailedMessage(null);
        setIsLoading(false);

        const thinkDelay = getTypingDelay(replyText, replyEmotion);
        setPresencePhase("thinking");
        emitPresenceChange("thinking");

        try {
          await presenceSleep(thinkDelay, abortController.signal);
        } catch {
          setPresencePhase("idle");
          emitPresenceChange("idle");
          setStreamingContent("");
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: replyText,
              emotion: data.predictedUserEmotion ?? replyEmotion,
              interactionId: data.interactionId,
            },
          ]);
          lastActivityRef.current = Date.now();
          emitTtsEvent(replyText, replyEmotion, data.behavior);
          return;
        }

        setPresencePhase("streaming");
        emitPresenceChange("streaming");
        const chunks = chunkReply(replyText, replyEmotion);
        let accumulated = "";

        for (const chunk of chunks) {
          if (abortController.signal.aborted) break;

          if (!chunk.isPause) {
            accumulated += (accumulated ? " " : "") + chunk.text;
            setStreamingContent(accumulated);
          }

          if (chunk.delayAfter > 0) {
            try {
              await presenceSleep(chunk.delayAfter, abortController.signal);
            } catch {
              break;
            }
          }
        }

        setStreamingContent("");
        setPresencePhase("idle");
        emitPresenceChange("idle");
        streamAbortRef.current = null;

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: replyText,
            emotion: data.predictedUserEmotion ?? replyEmotion,
            interactionId: data.interactionId,
          },
        ]);

        lastActivityRef.current = Date.now();
        emitTtsEvent(replyText, replyEmotion, data.behavior);

        if (showDebugPanel) {
          const memoryRes = await fetch(
            `/api/memory?userId=${encodeURIComponent(userId as string)}&limit=30`,
          );
          const memoryData = (await memoryRes.json()) as MemoryDebugResponse | { error?: string };
          if (memoryRes.ok && "memories" in memoryData) {
            setMemoryFacts(memoryData.memories);
          }
        }
      }
    } catch (requestError) {
      const messageText =
        requestError instanceof Error
          ? requestError.message
          : "Could not reach EVA right now.";
      setError(messageText);
      setFailedMessage(message);
      setIsLoading(false);
      setPresencePhase("idle");
      emitPresenceChange("idle");
    }
  }, [showDebugPanel, userId]);

  // Helper: emit TTS event after streaming completes
  function emitTtsEvent(reply: string, emotion: string, behavior?: ChatApiResponse["behavior"]) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("eva:assistant-reply", {
          detail: { reply, emotion, behavior },
        }),
      );
    }
  }

  // Helper: emit presence phase changes for avatar
  function emitPresenceChange(phase: string) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("eva:presence-change", { detail: { phase } }),
      );
    }
  }

  // Interruption: when user starts typing during streaming, flush instantly
  function handleInputChange(value: string) {
    setInput(value);
    if (presencePhase === "thinking" || presencePhase === "streaming") {
      streamAbortRef.current?.abort();
    }
  }

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

    // Initialize audio context immediately during user click gesture
    initSharedAudioContext();

    await fetchAssistantReply(message);
  }

  async function retryLastMessage(): Promise<void> {
    if (!failedMessage || isLoading) return;
    initSharedAudioContext();
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

      <div className="eva-chat-box" id="eva-chat-scroll" ref={chatBoxRef}>
        {isLoadingHistory && (
          <div className="eva-history-loading">
            <div className="eva-skeleton" />
            <div className="eva-skeleton eva-skeleton-short" />
            <div className="eva-skeleton" />
          </div>
        )}

        {!isLoadingHistory &&
          messages.map((item, index) => (
            <div key={`${item.role}-${index}`} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <p
                className={`eva-message ${item.role === "user" ? "eva-user" : "eva-assistant"}`}
              >
                <strong>{item.role === "user" ? "You" : "EVA"}</strong>
                {": "}
                {item.content}
              </p>
              {item.role === "assistant" && item.interactionId && !item.feedbackGiven && (
                <div style={{ alignSelf: "flex-start", display: "flex", gap: "8px", fontSize: "0.85rem", color: "var(--eva-muted)", alignItems: "center", marginLeft: "12px", marginBottom: "8px" }}>
                  <span>Helpful?</span>
                  <button onClick={() => handleFeedback(item.interactionId!, index, 1)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px", fontSize: "1rem" }}>👍</button>
                  <button onClick={() => handleFeedback(item.interactionId!, index, -1)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px", fontSize: "1rem" }}>👎</button>
                  {item.emotion && item.emotion !== "neutral" && (
                    <span style={{ marginLeft: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                      Does this feel right?
                      <button onClick={() => handleFeedback(item.interactionId!, index, 0, item.emotion)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "1rem", color: "var(--eva-muted)" }}>🙂</button>
                      <button onClick={() => handleFeedback(item.interactionId!, index, 0, "wrong")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "1rem", color: "var(--eva-muted)" }}>🙁</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

        {isLoading && (
          <div className="eva-typing-indicator">
            <span className="eva-typing-label">EVA</span>
            <div className="eva-typing-dots">
              <span className="eva-typing-dot" />
              <span className="eva-typing-dot" />
              <span className="eva-typing-dot" />
            </div>
          </div>
        )}

        {presencePhase === "thinking" && !isLoading && (
          <div className="eva-typing-indicator">
            <span className="eva-typing-label">EVA</span>
            <div className="eva-typing-dots">
              <span className="eva-typing-dot" />
              <span className="eva-typing-dot" />
              <span className="eva-typing-dot" />
            </div>
          </div>
        )}

        {presencePhase === "streaming" && streamingContent && (
          <p className="eva-message eva-assistant eva-chunk-enter">
            <strong>EVA</strong>: {streamingContent}
          </p>
        )}

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
            onChange={(event) => handleInputChange(event.target.value)}
            placeholder="How are you feeling today?"
            maxLength={1500}
            autoComplete="off"
            disabled={isLoadingHistory}
          />
          <button className="eva-btn" type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--eva-muted)", marginTop: "8px", textAlign: "center" }}>
          Conversations may be anonymized and used to make EVA more emotionally intelligent.
        </p>
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

          <p className="eva-note">User ID: {userId}</p>
          <p className="eva-note">Profile Name: {profileName}</p>
          <p className="eva-note">Memories: {memoryFacts.length}</p>
          <p className="eva-note">Bond Score: {lastContextDebug?.bondScore ?? "n/a"}</p>

          {memoryProfile && (
            <div className="eva-profile-panel">
              <p className="eva-note">Current profile: {memoryProfile.summary}</p>
              <p className="eva-note">
                Mood: {memoryProfile.dominantEmotion} | Mode: {memoryProfile.dominantReplyMode} | Tone: {memoryProfile.dominantTone}
              </p>
            </div>
          )}

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
                  {item.memoryMentionCount !== undefined && (
                    <>
                      {" "}
                      <span className="eva-pill">mentions {item.memoryMentionCount}</span>
                    </>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
