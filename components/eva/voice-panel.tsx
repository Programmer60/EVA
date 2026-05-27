"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Mic, Play, Square, Volume2, Settings2 } from "lucide-react";
import { speakWithFallback, stopAll as ttsStopAll, type VoiceBehavior } from "@/lib/audio/ttsManager";
import { initSharedAudioContext } from "@/lib/avatar/lipSyncAnalyzer";

interface VoicePanelProps {
  className?: string;
}

export function VoicePanel({ className }: VoicePanelProps) {
  const [autoPlay, setAutoPlay] = useState(true);
  const autoPlayRef = useRef(autoPlay);
  const [ttsMode, setTtsMode] = useState<"browser" | "server" | "google">("google");
  const ttsModeRef = useRef(ttsMode);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Track last message to allow replay
  const lastReplyRef = useRef<{ reply: string; emotion: string; behavior?: VoiceBehavior } | null>(null);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    ttsModeRef.current = ttsMode;
  }, [ttsMode]);

  useEffect(() => {
    function handleAssistantReply(e: Event) {
      if (!autoPlayRef.current) return;
      const customEvent = e as CustomEvent<{ reply: string; emotion: string; behavior?: VoiceBehavior }>;
      const replyText = customEvent.detail?.reply;
      const emotion = customEvent.detail?.emotion;
      const behavior = customEvent.detail?.behavior;

      if (!replyText) return;

      lastReplyRef.current = { reply: replyText, emotion: emotion ?? "neutral", behavior };

      if (!autoPlayRef.current) return;

      initSharedAudioContext();

      speakWithFallback(replyText, {
        preferredMode: ttsModeRef.current,
        serverTtsEnabled: true,
        googleEnabled: true,
        behavior,
      }).catch((err) => {
        console.error("TTS failed:", err);
        window.dispatchEvent(new CustomEvent("eva:tts-end"));
      });
    }

    window.addEventListener("eva:assistant-reply", handleAssistantReply);
    return () => window.removeEventListener("eva:assistant-reply", handleAssistantReply);
  }, []);

  const handleStop = () => {
    ttsStopAll();
  };

  const handlePlay = () => {
    const last = lastReplyRef.current;
    if (!last) return;
    
    initSharedAudioContext();
    ttsStopAll(); // Stop anything currently playing first
    
    speakWithFallback(last.reply, {
      preferredMode: ttsModeRef.current,
      serverTtsEnabled: true,
      googleEnabled: true,
      behavior: last.behavior,
    }).catch((err) => {
      console.error("TTS failed:", err);
      window.dispatchEvent(new CustomEvent("eva:tts-end"));
    });
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm overflow-hidden transition-all duration-300",
        className
      )}
    >
      {/* Compact header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Voice Controls</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
            {ttsMode === "browser" ? "Browser" : "Google Studio"} TTS
          </span>
          <Settings2 className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-90"
          )} />
        </div>
      </button>

      {/* Expandable content */}
      <div className={cn(
        "overflow-hidden transition-all duration-300",
        isExpanded ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-4 pb-4 space-y-4">
          {/* TTS Mode Selection */}
          <div className="flex gap-2">
            <button
              onClick={() => setTtsMode("browser")}
              className={cn(
                "flex-1 rounded-xl py-2 px-3 text-xs font-medium transition-all border",
                ttsMode === "browser"
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-muted/20 text-muted-foreground border-transparent hover:bg-muted/40"
              )}
            >
              Browser TTS
            </button>
            <button
              onClick={() => setTtsMode("google")}
              className={cn(
                "flex-1 rounded-xl py-2 px-3 text-xs font-medium transition-all border",
                ttsMode === "google"
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-muted/20 text-muted-foreground border-transparent hover:bg-muted/40"
              )}
            >
              Google Studio
            </button>
          </div>

          {/* Voice Controls */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handlePlay} variant="ghost" size="sm" className="rounded-xl text-xs flex-1 border border-border/50 bg-background/50">
              <Play className="h-3.5 w-3.5 mr-1.5 text-primary" />
              Repeat
            </Button>
            <Button onClick={handleStop} variant="ghost" size="sm" className="rounded-xl text-xs flex-1 border border-border/50 bg-background/50">
              <Square className="h-3.5 w-3.5 mr-1.5 text-red-500" />
              Stop
            </Button>
          </div>

          {/* Auto-play toggle */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                autoPlay ? "bg-emerald-500" : "bg-muted-foreground/30"
              )}
              onClick={() => setAutoPlay(!autoPlay)}
            >
              <div
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                  autoPlay ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </div>
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              Auto-play EVA replies
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
