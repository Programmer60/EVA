"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  message: string;
  sender: "user" | "eva";
  timestamp?: string;
  className?: string;
  isNew?: boolean;
  interactionId?: string;
  feedbackGiven?: "positive" | "negative";
  onFeedback?: (type: "positive" | "negative") => void;
}

export function ChatBubble({ 
  message, 
  sender, 
  timestamp, 
  className,
  isNew = false,
  interactionId,
  feedbackGiven,
  onFeedback
}: ChatBubbleProps) {
  const [showTimestamp, setShowTimestamp] = useState(false);
  const isUser = sender === "user";

  return (
    <div
      className={cn(
        "flex w-full group",
        isUser ? "justify-end" : "justify-start",
        isNew && "animate-in fade-in slide-in-from-bottom-2 duration-300",
        className
      )}
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
    >
      <div className="flex flex-col gap-1 max-w-[85%] relative">
        {/* Sender label for EVA */}
        {!isUser && (
          <span className="text-xs font-medium text-primary/70 ml-3">EVA</span>
        )}
        
        <div
          className={cn(
            "relative rounded-2xl px-4 py-3 transition-all duration-300",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md shadow-md shadow-primary/10"
              : "bg-card/80 border border-border/40 text-card-foreground rounded-bl-md shadow-sm backdrop-blur-sm"
          )}
        >
          <p className="text-sm leading-relaxed">{message}</p>
          
          {/* Timestamp on hover */}
          <div
            className={cn(
              "absolute -bottom-5 transition-all duration-200",
              isUser ? "right-0" : "left-0",
              showTimestamp ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
            )}
          >
            {timestamp && (
              <span className="text-[10px] text-muted-foreground/60">
                {timestamp}
              </span>
            )}
          </div>
        </div>

        {/* Feedback Buttons for EVA */}
        {!isUser && interactionId && (
          <div className={cn(
            "absolute -right-16 bottom-2 flex gap-1 transition-opacity duration-200",
            showTimestamp || feedbackGiven ? "opacity-100" : "opacity-0"
          )}>
            <button
              onClick={() => onFeedback?.("positive")}
              disabled={!!feedbackGiven}
              className={cn(
                "p-1.5 rounded-full hover:bg-emerald-500/10 transition-colors",
                feedbackGiven === "positive" ? "text-emerald-500" : "text-muted-foreground hover:text-emerald-500"
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
            </button>
            <button
              onClick={() => onFeedback?.("negative")}
              disabled={!!feedbackGiven}
              className={cn(
                "p-1.5 rounded-full hover:bg-red-500/10 transition-colors",
                feedbackGiven === "negative" ? "text-red-500" : "text-muted-foreground hover:text-red-500"
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
