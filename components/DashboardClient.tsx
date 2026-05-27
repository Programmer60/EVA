"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { AvatarPanel } from "@/components/avatar/AvatarPanel";
import { StatusChips } from "@/components/eva/status-chips";
import { ConversationPanel } from "@/components/eva/conversation-panel";
import { VoicePanel } from "@/components/eva/voice-panel";
import { UserButton } from "@clerk/nextjs";
import { Info, Shield } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type EvaState = "idle" | "listening" | "speaking" | "thinking";
type Mood = "peaceful" | "curious" | "happy" | "concerned" | "reflective";

const stateMessages: Record<EvaState, string> = {
  idle: "I'm here with you",
  listening: "I'm listening...",
  speaking: "Let me share my thoughts",
  thinking: "Reflecting on that...",
};

const moodDescriptions: Record<Mood, string> = {
  peaceful: "Peaceful",
  curious: "Curious",
  happy: "Joyful",
  concerned: "Attentive",
  reflective: "Thoughtful",
};

export default function DashboardClient({ profile, analytics }: { profile: any, analytics: any }) {
  const [evaState, setEvaState] = useState<EvaState>("idle");
  const [mood, setMood] = useState<Mood>("peaceful");
  const [currentTime, setCurrentTime] = useState("");
  
  // Resize Panel State
  const [panelWidth, setPanelWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);

  // Load saved width on mount
  useEffect(() => {
    const saved = localStorage.getItem("eva_panel_width");
    if (saved) {
      setPanelWidth(parseInt(saved, 10));
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Calculate new width relative to right edge of screen.
      // 32px accounts for padding (px-8 usually equals 32px on lg screens).
      let newWidth = window.innerWidth - moveEvent.clientX - 32; 
      
      // Clamp width between min (300px) and max (800px or 60vw)
      if (newWidth < 300) newWidth = 300;
      const maxW = Math.min(800, window.innerWidth * 0.6);
      if (newWidth > maxW) newWidth = maxW;
      
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Save width when dragging stops
  useEffect(() => {
    if (!isDragging && panelWidth !== 380) {
      localStorage.setItem("eva_panel_width", panelWidth.toString());
    }
  }, [isDragging, panelWidth]);


  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const stateLabels: Record<EvaState, string> = {
    idle: "Present",
    listening: "Listening",
    speaking: "Speaking",
    thinking: "Thinking",
  };

  // Derive real mood from analytics/profile
  const realMood = (profile?.dominantEmotion || analytics?.dominantEmotion || "peaceful").toLowerCase();
  // Map actual emotion to our UI mood colors/text if needed
  const displayMood: Mood = ["peaceful", "curious", "happy", "concerned", "reflective"].includes(realMood) 
    ? (realMood as Mood) 
    : "peaceful";

  return (
    <main className="h-screen bg-linear-to-br from-blue-50 via-indigo-50/40 to-teal-50 dark:from-slate-950 dark:via-slate-900/80 dark:to-slate-800 overflow-hidden flex flex-col transition-colors duration-1000">
      {/* Ambient background - mood responsive with breathing halo */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Central animated breathing halo behind EVA */}
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-200 h-200 rounded-full blur-[120px] opacity-60 animate-pulse transition-colors duration-1000 mix-blend-screen"
          style={{ 
            backgroundColor: displayMood === "happy" ? "rgba(251, 191, 36, 0.12)" : 
                            displayMood === "curious" ? "rgba(56, 189, 248, 0.12)" :
                            displayMood === "concerned" ? "rgba(251, 146, 60, 0.12)" :
                            displayMood === "reflective" ? "rgba(167, 139, 250, 0.12)" :
                            "rgba(52, 211, 153, 0.12)",
            animationDuration: "4s"
          }}
        />
        
        {/* Subtle corner accents */}
        <div className="absolute top-0 right-0 w-125 h-125 bg-primary/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-0 w-150 h-150 bg-accent/5 rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 h-full flex flex-col">
        {/* Minimal Header with Profile */}
        <header className="flex items-center justify-between px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card/70 border border-border/30 shadow-sm overflow-hidden">
              <Image
                src="/eva_logo.png"
                alt="EVA logo"
                width={64}
                height={64}
                priority
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <h1 className="font-serif text-2xl lg:text-3xl font-medium text-foreground tracking-tight">
                EVA
              </h1>
              <p className="text-xs text-muted-foreground/60 tracking-wide">
                Emotional Awareness Companion
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground/50 hidden sm:block">{currentTime}</span>
            
            {/* Status indicator */}
            <div className="flex items-center gap-2 rounded-full bg-card/50 border border-border/20 backdrop-blur-sm px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span 
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                  style={{
                    backgroundColor: evaState === "listening" ? "rgb(34, 211, 238)" :
                                    evaState === "speaking" ? "rgb(251, 191, 36)" :
                                    evaState === "thinking" ? "rgb(167, 139, 250)" :
                                    "rgb(52, 211, 153)"
                  }}
                />
                <span 
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: evaState === "listening" ? "rgb(34, 211, 238)" :
                                    evaState === "speaking" ? "rgb(251, 191, 36)" :
                                    evaState === "thinking" ? "rgb(167, 139, 250)" :
                                    "rgb(52, 211, 153)"
                  }}
                />
              </span>
              <span className="text-sm text-foreground/70">
                {stateLabels[evaState]}
              </span>
            </div>

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Profile button - circular, minimal */}
            <UserButton appearance={{ elements: { userButtonAvatarBox: "w-10 h-10 border border-border/30 shadow-sm" } }}>
              <UserButton.MenuItems>
                <UserButton.Link
                  label="About Us"
                  labelIcon={<Info className="w-4 h-4" />}
                  href="/about"
                />
                <UserButton.Link
                  label="Privacy Policy"
                  labelIcon={<Shield className="w-4 h-4" />}
                  href="/privacy"
                />
              </UserButton.MenuItems>
            </UserButton>
          </div>
        </header>

        {/* Main Content - Avatar as the hero */}
        <div className="flex-1 flex flex-col lg:flex-row gap-6 px-4 lg:px-8 pb-6 min-h-0">
          
          {/* Left/Main: Avatar Area - Takes up most space */}
          <div className="flex-1 flex flex-col items-center justify-center min-h-112.5 lg:min-h-0">
            
            {/* The 3D VRM Avatar */}
            <div className="relative flex-1 flex flex-col items-center justify-center w-full py-8">
              <AvatarPanel />
              <p className="mt-4 text-center text-muted-foreground/60 font-serif italic">
                {stateMessages[evaState]}
              </p>
              
              {/* Compact status chips below avatar */}
              <div className="mt-6 z-10 relative">
                <StatusChips
                  bond={profile?.bondTier ?? "new"}
                  mood={profile?.dominantEmotion ?? analytics?.dominantEmotion ?? "peaceful"}
                  threads={profile?.activeArcs ?? analytics?.activeArcs ?? 0}
                  wellness={profile?.dominantReplyMode ?? analytics?.dominantReplyMode ?? "react"}
                />
              </div>
            </div>
          </div>

          {/* Right: Conversation - Secondary focus */}
          <div 
            className="w-full lg:w-[var(--panel-width)] flex flex-col gap-4 min-h-0 relative shrink-0"
            style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
          >
            {/* Drag Handle Divider */}
            <div 
              className={`hidden lg:flex absolute -left-5 top-0 bottom-0 w-4 cursor-col-resize z-20 items-center justify-center group`}
              onMouseDown={handleMouseDown}
            >
              <div className={`w-1 h-12 rounded-full transition-colors duration-200 ${isDragging ? 'bg-primary/50' : 'bg-primary/0 group-hover:bg-primary/20'}`} />
            </div>

            <ConversationPanel className="flex-1 min-h-0" />
            <VoicePanel />
          </div>
        </div>
      </div>
    </main>
  );
}
