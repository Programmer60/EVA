"use client";

import { useState, useRef, useEffect } from "react";
import { ChatBubble } from "./chat-bubble";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Mic, Send, Keyboard, Sparkles } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { consumeChatStream } from "@/lib/chat/streaming";
import { getTypingDelay, chunkReply, presenceSleep } from "@/lib/presence/presenceEngine";
import { initSharedAudioContext } from "@/lib/avatar/lipSyncAnalyzer";

type ChatApiResponse = {
  reply: string;
  emotion?: string;
  predictedUserEmotion?: string;
  behavior?: {
    speechRate: number;
    pitch: number;
    avatarMood: string;
  };
  interactionId?: string;
};

interface Message {
  id: string;
  message: string;
  sender: "user" | "eva";
  timestamp: string;
  isNew?: boolean;
  interactionId?: string;
  predictedUserEmotion?: string;
  feedbackGiven?: "positive" | "negative";
}

interface ConversationPanelProps {
  className?: string;
}

const initialMessages: Message[] = [
  {
    id: "1",
    message: "Hello! I'm here whenever you'd like to talk. How are you feeling today?",
    sender: "eva",
    timestamp: "Just now",
  },
];

export function ConversationPanel({ className }: ConversationPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [presencePhase, setPresencePhase] = useState<"idle" | "thinking" | "streaming">("idle");
  const [streamingContent, setStreamingContent] = useState("");
  const [currentEmotion, setCurrentEmotion] = useState<string>("neutral");
  const [inputMode, setInputMode] = useState<"voice" | "text">("text");
  const [isListening, setIsListening] = useState(false);
  const { userId } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Initiative State Tracking
  const lastActivityRef = useRef<number>(Date.now());
  const pendingInitiativeRef = useRef(false);
  const hasTriggeredInitiative = useRef(false);

  // Trigger Proactive Greeting (Initiative)
  const triggerProactiveGreeting = async () => {
    if (hasTriggeredInitiative.current) return;
    hasTriggeredInitiative.current = true;
    try {
      const res = await fetch("/api/chat/initiative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // Auth is server-side now
      });
      const d = await res.json();

      if (d.action === "silence") {
        hasTriggeredInitiative.current = false;
        return;
      }

      if (d.reply) {
        pendingInitiativeRef.current = true;
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            message: d.reply,
            sender: "eva",
            timestamp: "Just now",
            isNew: true,
          },
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
      lastActivityRef.current = Date.now();
    }
  };

  function emitPresenceChange(phase: string) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("eva:presence-change", { detail: { phase } }),
      );
    }
  }

  useEffect(() => {
    if (!userId) return;

    async function loadHistory() {
      try {
        const res = await fetch(`/api/history?limit=20`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            const historyMessages = data.messages.map((msg: any, i: number) => ({
              id: `hist-${i}`,
              message: msg.content,
              sender: msg.role === "user" ? "user" : "eva",
              timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "Past",
              isNew: false,
            }));
            setMessages(historyMessages);
            
            // Check for stale session to trigger initiative
            const lastMsg = data.messages[data.messages.length - 1];
            if (lastMsg && lastMsg.timestamp) {
              lastActivityRef.current = new Date(lastMsg.timestamp).getTime();
              if (Date.now() - lastActivityRef.current > 6 * 60 * 60 * 1000) {
                void triggerProactiveGreeting();
              }
            }
          } else {
            // First time user, trigger greeting
            void triggerProactiveGreeting();
          }
        }
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
    
    loadHistory();
  }, [userId]);

  // Listen for Voice Drafts from speech engine
  useEffect(() => {
    const handleVoiceDraft = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.text) {
        setInputValue(customEvent.detail.text);
      }
    };
    window.addEventListener("eva:voice-draft", handleVoiceDraft);
    return () => window.removeEventListener("eva:voice-draft", handleVoiceDraft);
  }, []);

  // Polling for inactivity
  useEffect(() => {
    if (!userId) return;
    const timer = setInterval(() => {
      if (hasTriggeredInitiative.current) return;
      if (Date.now() - lastActivityRef.current > 6 * 60 * 60 * 1000) {
        void triggerProactiveGreeting();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [userId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;
        
        recognitionRef.current.onresult = (event: any) => {
          let transcript = "";
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setInputValue(transcript);
        };
        
        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }
  }, []);

  const isAutoScrollEnabled = useRef(true);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // If user scrolls up more than 100px from bottom, disable auto-scroll
      isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  };

  useEffect(() => {
    if (scrollRef.current && isAutoScrollEnabled.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages, streamingContent, presencePhase]);

  // Remove isNew flag after animation
  useEffect(() => {
    const timer = setTimeout(() => {
      setMessages(prev => prev.map(msg => ({ ...msg, isNew: false })));
    }, 500);
    return () => clearTimeout(timer);
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    // Initialize audio context for mobile playback policies
    try {
      initSharedAudioContext();
    } catch {
      // Ignore if not in browser or already initialized
    }

    // Track activity & clear initiative state
    lastActivityRef.current = Date.now();
    hasTriggeredInitiative.current = false;
    if (pendingInitiativeRef.current) {
      pendingInitiativeRef.current = false;
      fetch("/api/chat/initiative/respond", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // Auth is handled server-side now
      }).catch(() => {});
    }

    if (presencePhase === "thinking" || presencePhase === "streaming") {
      streamAbortRef.current?.abort();
    }

    const userText = inputValue;
    const newMessage: Message = {
      id: Date.now().toString(),
      message: userText,
      sender: "user",
      timestamp: "Just now",
      isNew: true,
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputValue("");
    setIsTyping(true);
    setPresencePhase("thinking");
    emitPresenceChange("thinking");

    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    const timeoutMs = 120000;
    const timeoutId = window.setTimeout(() => abortController.abort("timeout"), timeoutMs);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, stream: true }),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error((errorData as { error?: string } | null)?.error || "Failed to fetch response");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        let startedStreaming = false;
        const finalData = await consumeChatStream(response, {
          onToken: (delta) => {
            if (!startedStreaming) {
              startedStreaming = true;
              setPresencePhase("streaming");
              emitPresenceChange("streaming");
              setIsTyping(false);
            }
            setStreamingContent((prev) => prev + delta);
          },
        });

        setIsTyping(false);
        if (!startedStreaming) {
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
            id: Date.now().toString(),
            message: finalData.reply,
            sender: "eva",
            timestamp: "Just now",
            isNew: true,
            interactionId: finalData.interactionId,
            predictedUserEmotion: finalData.predictedUserEmotion,
          },
        ]);
        
        setCurrentEmotion(finalData.emotion ?? "neutral");

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("eva:assistant-reply", {
              detail: {
                reply: finalData.reply,
                emotion: finalData.emotion ?? "neutral",
                behavior: finalData.behavior,
              },
            })
          );
        }
        return;
      }

      const data = (await response.json()) as ChatApiResponse | { error?: string };
      if (!("reply" in data)) {
        const errorMessage = "error" in data ? data.error : undefined;
        throw new Error(errorMessage || "Failed to fetch response");
      }

      const replyText = data.reply || "...";
      const replyEmotion = data.emotion ?? "neutral";

      setIsTyping(false);
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
            id: (Date.now() + 1).toString(),
            message: replyText,
            sender: "eva",
            timestamp: "Just now",
            isNew: true,
            interactionId: data.interactionId,
            predictedUserEmotion: data.predictedUserEmotion,
          },
        ]);
        
        setCurrentEmotion(replyEmotion);

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("eva:assistant-reply", {
              detail: { reply: replyText, emotion: replyEmotion, behavior: data.behavior },
            })
          );
        }
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
          id: (Date.now() + 1).toString(),
          message: replyText,
          sender: "eva",
          timestamp: "Just now",
          isNew: true,
          interactionId: data.interactionId,
          predictedUserEmotion: data.predictedUserEmotion,
        },
      ]);
      
      setCurrentEmotion(replyEmotion);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("eva:assistant-reply", {
            detail: { reply: replyText, emotion: replyEmotion, behavior: data.behavior },
          })
        );
      }
    } catch (e) {
      const isAbortError = e instanceof DOMException && e.name === "AbortError";
      if (!isAbortError) {
        console.error("Chat error:", e);
      }
      setIsTyping(false);
      setPresencePhase("idle");
      emitPresenceChange("idle");
      streamAbortRef.current = null;
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          message: isAbortError
            ? "Response is taking longer than expected. Please try again or switch to a faster model."
            : "Sorry, I am having trouble connecting right now.",
          sender: "eva",
          timestamp: "Just now",
          isNew: true,
        },
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const handleFeedback = async (msgId: string, interactionId: string, type: "positive" | "negative") => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, feedbackGiven: type } : m
      )
    );
    try {
      await fetch("/api/training/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId, type, userId }),
      });
    } catch {
      // silently fail feedback network errors
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    
    try {
      if (isListening) {
        recognitionRef.current.stop();
        setIsListening(false);
      } else {
        setInputValue("");
        recognitionRef.current.start();
        setIsListening(true);
      }
    } catch (err) {
      console.warn("Speech recognition error:", err);
      // If it's already started, just set state to true
      setIsListening(true);
    }
  };
  return (
    <div
      className={cn(
        "flex flex-col rounded-3xl border border-border/40 bg-linear-to-br from-blue-50/60 via-indigo-50/60 to-teal-50/60 dark:from-slate-900/80 dark:via-slate-800/80 dark:to-slate-900/80 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-5 py-4 bg-linear-to-r from-card/80 to-card/40">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">Conversation</h3>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
              <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", 
                currentEmotion === "happy" ? "bg-emerald-500" : 
                currentEmotion === "sad" ? "bg-blue-500" : 
                currentEmotion === "angry" ? "bg-red-500" : "bg-purple-500")} 
              />
              {currentEmotion || "Live"}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setInputMode(inputMode === "voice" ? "text" : "voice")}
          className="text-muted-foreground hover:text-foreground rounded-xl"
        >
          {inputMode === "voice" ? (
            <Keyboard className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-5 overflow-y-auto p-5 min-h-0"
      >
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg.message}
            sender={msg.sender}
            timestamp={msg.timestamp}
            isNew={msg.isNew}
            interactionId={msg.interactionId}
            feedbackGiven={msg.feedbackGiven}
            onFeedback={(type) => {
              if (msg.interactionId) handleFeedback(msg.id, msg.interactionId, type);
            }}
          />
        ))}

        {/* Presence / Thinking Indicator */}
        {(presencePhase === "thinking" || (isTyping && presencePhase !== "streaming")) && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground pl-3">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10">
              <Sparkles className="h-3 w-3 text-primary animate-pulse" />
            </div>
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
              <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
              <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
            </span>
            <span className="text-xs">EVA is reflecting...</span>
          </div>
        )}

        {/* Streaming Text */}
        {presencePhase === "streaming" && streamingContent && (
          <ChatBubble
            message={streamingContent}
            sender="eva"
            timestamp="Just now"
            isNew={false}
          />
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/30 p-4 bg-linear-to-r from-muted/20 to-muted/10">
        {inputMode === "text" ? (
          <div className="flex gap-3">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                // Presence engine: interruption logic
                if (e.target.value.length > 0 && (presencePhase === "thinking" || presencePhase === "streaming")) {
                  streamAbortRef.current?.abort();
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Share what's on your mind..."
              className="flex-1 rounded-2xl border border-border/50 bg-background/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="rounded-2xl px-4 shadow-md shadow-primary/20"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <Button
              onClick={toggleListening}
              variant={isListening ? "default" : "outline"}
              size="lg"
              className={cn(
                "rounded-full h-14 w-14 transition-all duration-300 shadow-lg",
                isListening && "animate-pulse shadow-primary/40 bg-primary"
              )}
            >
              <Mic className={cn("h-5 w-5", isListening && "text-primary-foreground")} />
            </Button>
            <p className="text-xs text-muted-foreground">
              {isListening ? "Listening..." : "Tap to speak"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
