"use client";

import { User, Settings, LogOut, Shield, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ProfileButtonProps {
  userName?: string;
  userImage?: string;
  className?: string;
}

export function ProfileButton({ 
  userName = "User", 
  userImage,
  className 
}: ProfileButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center",
          "bg-card/60 border border-border/30 backdrop-blur-sm",
          "hover:bg-card/80 hover:border-border/50 transition-all duration-300",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-background",
          "shadow-sm hover:shadow-md"
        )}
        aria-label="Open profile menu"
      >
        {userImage ? (
          <img 
            src={userImage} 
            alt={userName}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <User className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop to close menu */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          
          <div className={cn(
            "absolute right-0 top-full mt-2 z-50",
            "w-48 py-2 rounded-xl",
            "bg-card/95 backdrop-blur-lg border border-border/40",
            "shadow-lg shadow-black/10",
            "animate-in fade-in-0 zoom-in-95 duration-200"
          )}>
            {/* User info */}
            <div className="px-4 py-2 border-b border-border/30">
              <p className="text-sm font-medium text-foreground">{userName}</p>
              <p className="text-xs text-muted-foreground">Companion Member</p>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50 transition-colors">
                <User className="w-4 h-4" />
                <span>Account</span>
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50 transition-colors">
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
              <a href="/privacy" className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50 transition-colors">
                <Shield className="w-4 h-4" />
                <span>Privacy</span>
              </a>
              <a href="/contact" className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50 transition-colors">
                <Mail className="w-4 h-4" />
                <span>Contact</span>
              </a>
            </div>

            <div className="border-t border-border/30 py-1">
              <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
