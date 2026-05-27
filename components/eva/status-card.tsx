"use client";

import { cn } from "@/lib/utils";

interface StatusCardProps {
  label: string;
  value: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
  variant?: "default" | "accent" | "muted";
}

export function StatusCard({
  label,
  value,
  description,
  icon,
  className,
  variant = "default",
}: StatusCardProps) {
  const variants = {
    default: "bg-card/60 border-border/50",
    accent: "bg-accent/20 border-accent/30",
    muted: "bg-muted/40 border-muted-foreground/10",
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-5 backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/5",
        variants[variant],
        className
      )}
    >
      {/* Subtle hover gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      
      <div className="relative space-y-3">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-muted-foreground">{icon}</span>
          )}
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        
        <p className="font-serif text-2xl font-medium text-foreground">
          {value}
        </p>
        
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
