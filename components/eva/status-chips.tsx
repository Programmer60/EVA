"use client";

import { cn } from "@/lib/utils";
import { Heart, Sparkles, MessageCircle, Leaf } from "lucide-react";
import type { Mood } from "./breathing-orb";

interface StatusChipsProps {
  bond: string;
  mood: Mood;
  threads: number;
  wellness: string;
  className?: string;
}

const bondLabels: Record<string, string> = {
  new: "🌱 New acquaintance",
  warming: "🌿 Familiar",
  comfortable: "🌸 Trusted",
  close: "⭐ Close companion",
};

export function StatusChips({ bond, className }: StatusChipsProps) {
  const displayLabel = bondLabels[bond] || bondLabels.new;

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div className="flex items-center gap-2 rounded-full bg-card/80 border border-border/50 shadow-sm backdrop-blur-md px-4 py-2 text-foreground/80 transition-all hover:bg-card hover:shadow-md">
        <span className="text-sm font-medium tracking-wide">{displayLabel}</span>
      </div>
    </div>
  );
}
