"use client";

import { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";

export type Mood = "peaceful" | "curious" | "happy" | "concerned" | "reflective";
export type EvaState = "idle" | "listening" | "speaking" | "thinking";

interface BreathingOrbProps {
  mood?: Mood;
  state?: EvaState;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showMessage?: boolean;
  message?: string;
  avatarSlot?: React.ReactNode;
}

const moodConfig: Record<Mood, { colors: string; aura: string; accent: string }> = {
  peaceful: {
    colors: "from-emerald-400/60 via-teal-300/40 to-cyan-400/30",
    aura: "bg-emerald-400/20",
    accent: "rgba(52, 211, 153, 0.4)",
  },
  curious: {
    colors: "from-sky-400/60 via-blue-400/40 to-indigo-400/30",
    aura: "bg-sky-400/20",
    accent: "rgba(56, 189, 248, 0.4)",
  },
  happy: {
    colors: "from-amber-300/70 via-yellow-300/50 to-orange-300/40",
    aura: "bg-amber-300/25",
    accent: "rgba(251, 191, 36, 0.5)",
  },
  concerned: {
    colors: "from-amber-500/50 via-orange-400/40 to-rose-400/30",
    aura: "bg-amber-400/20",
    accent: "rgba(251, 146, 60, 0.4)",
  },
  reflective: {
    colors: "from-violet-400/60 via-purple-400/40 to-fuchsia-400/30",
    aura: "bg-violet-400/20",
    accent: "rgba(167, 139, 250, 0.4)",
  },
};

// State-based animation configurations
const stateAnimations: Record<EvaState, { 
  breathSpeed: number; 
  pulseIntensity: number; 
  rotationSpeed: number;
  particleSpeed: number;
  scaleRange: [number, number];
}> = {
  idle: {
    breathSpeed: 80,
    pulseIntensity: 0.06,
    rotationSpeed: 80,
    particleSpeed: 50,
    scaleRange: [1, 1.06],
  },
  listening: {
    breathSpeed: 40, // Faster pulse pulse pulse
    pulseIntensity: 0.12,
    rotationSpeed: 60,
    particleSpeed: 30,
    scaleRange: [0.98, 1.1],
  },
  speaking: {
    breathSpeed: 50, // Rhythmic expand-contract
    pulseIntensity: 0.15,
    rotationSpeed: 40,
    particleSpeed: 25,
    scaleRange: [0.95, 1.12],
  },
  thinking: {
    breathSpeed: 120, // Slow, contemplative
    pulseIntensity: 0.04,
    rotationSpeed: 200, // Slow rotating glow
    particleSpeed: 80,
    scaleRange: [1, 1.03],
  },
};

export function BreathingOrb({ 
  mood = "peaceful", 
  state = "idle",
  size = "xl", 
  className,
  showMessage = true,
  message = "I'm here with you",
  avatarSlot
}: BreathingOrbProps) {
  const [breathPhase, setBreathPhase] = useState(0);
  const [particlePhase, setParticlePhase] = useState(0);
  const [rotationPhase, setRotationPhase] = useState(0);

  const stateConfig = stateAnimations[state];
  const config = moodConfig[mood];

  useEffect(() => {
    const breathInterval = setInterval(() => {
      setBreathPhase((prev) => (prev + 1) % 100);
    }, stateConfig.breathSpeed);
    
    return () => clearInterval(breathInterval);
  }, [stateConfig.breathSpeed]);

  useEffect(() => {
    const particleInterval = setInterval(() => {
      setParticlePhase((prev) => (prev + 1) % 360);
    }, stateConfig.particleSpeed);
    
    return () => clearInterval(particleInterval);
  }, [stateConfig.particleSpeed]);

  useEffect(() => {
    const rotationInterval = setInterval(() => {
      setRotationPhase((prev) => (prev + 1) % 360);
    }, stateConfig.rotationSpeed);
    
    return () => clearInterval(rotationInterval);
  }, [stateConfig.rotationSpeed]);

  const sizeClasses = {
    sm: "w-24 h-24",
    md: "w-36 h-36",
    lg: "w-52 h-52",
    xl: "w-72 h-72",
  };

  const containerSizes = {
    sm: "w-40 h-40",
    md: "w-56 h-56",
    lg: "w-80 h-80",
    xl: "w-[420px] h-[420px]",
  };

  // Calculate breathing animation based on state
  const breathValue = Math.sin((breathPhase / 100) * Math.PI * 2);
  const breathScale = stateConfig.scaleRange[0] + 
    ((stateConfig.scaleRange[1] - stateConfig.scaleRange[0]) * (breathValue + 1) / 2);
  
  const glowOpacity = 0.4 + breathValue * 0.3 * stateConfig.pulseIntensity * 10;
  const pulseScale = 1 + breathValue * stateConfig.pulseIntensity * 2;

  // Listening state: additional rapid pulse rings
  const listeningPulses = useMemo(() => {
    if (state !== "listening") return [];
    return Array.from({ length: 3 }, (_, i) => ({
      delay: i * 0.3,
      scale: 1 + (breathPhase + i * 30) % 100 / 100,
    }));
  }, [state, breathPhase]);

  // Speaking state: wave-like expansion
  const speakingWaves = useMemo(() => {
    if (state !== "speaking") return [];
    return Array.from({ length: 4 }, (_, i) => {
      const phase = ((breathPhase * 2 + i * 25) % 100) / 100;
      return {
        scale: 1 + phase * 0.4,
        opacity: (1 - phase) * 0.3,
      };
    });
  }, [state, breathPhase]);

  // Thinking state: rotating particles
  const thinkingParticles = useMemo(() => {
    if (state !== "thinking") return [];
    return Array.from({ length: 8 }, (_, i) => {
      const angle = ((rotationPhase + i * 45) * Math.PI) / 180;
      const radius = 140;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        opacity: 0.2 + Math.sin(angle * 2) * 0.15,
      };
    });
  }, [state, rotationPhase]);

  // Floating particles around the orb (always present)
  const particles = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const angle = ((particlePhase + i * 60) * Math.PI) / 180;
      const radius = 160 + Math.sin(angle * 2) * 25;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const opacity = 0.25 + Math.sin(angle) * 0.15;
      return { x, y, opacity };
    });
  }, [particlePhase]);

  return (
    <div className={cn("relative flex flex-col items-center justify-center", className)}>
      {/* Main orb container */}
      <div className={cn("relative flex items-center justify-center", containerSizes[size])}>
        
        {/* Outermost emotional aura */}
        <div
          className={cn(
            "absolute rounded-full blur-3xl transition-colors duration-1000",
            config.aura
          )}
          style={{
            width: "160%",
            height: "160%",
            transform: `scale(${pulseScale})`,
            opacity: glowOpacity * 0.5,
          }}
        />

        {/* Listening pulse rings */}
        {listeningPulses.map((pulse, i) => (
          <div
            key={`listen-${i}`}
            className="absolute rounded-full border-2 border-cyan-400/30"
            style={{
              width: "100%",
              height: "100%",
              transform: `scale(${pulse.scale})`,
              opacity: Math.max(0, 1 - pulse.scale) * 0.5,
              transition: "transform 0.1s ease-out",
            }}
          />
        ))}

        {/* Speaking wave rings */}
        {speakingWaves.map((wave, i) => (
          <div
            key={`speak-${i}`}
            className={cn("absolute rounded-full", config.aura)}
            style={{
              width: "90%",
              height: "90%",
              transform: `scale(${wave.scale})`,
              opacity: wave.opacity,
            }}
          />
        ))}

        {/* Thinking rotating particles */}
        {thinkingParticles.map((particle, i) => (
          <div
            key={`think-${i}`}
            className="absolute w-3 h-3 rounded-full bg-violet-400/50 blur-sm"
            style={{
              transform: `translate(${particle.x}px, ${particle.y}px)`,
              opacity: particle.opacity,
            }}
          />
        ))}

        {/* Ambient floating particles */}
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full bg-white/30 blur-[2px]"
            style={{
              transform: `translate(${particle.x}px, ${particle.y}px)`,
              opacity: particle.opacity,
            }}
          />
        ))}

        {/* Secondary aura layer */}
        <div
          className={cn(
            "absolute rounded-full blur-2xl transition-colors duration-700",
            sizeClasses[size],
            "bg-gradient-to-br",
            config.colors
          )}
          style={{
            transform: `scale(${breathScale * 1.5})`,
            opacity: glowOpacity * 0.7,
          }}
        />

        {/* Inner glow layer */}
        <div
          className={cn(
            "absolute rounded-full blur-xl transition-colors duration-500",
            sizeClasses[size],
            "bg-gradient-to-br",
            config.colors
          )}
          style={{
            transform: `scale(${breathScale * 1.2})`,
            opacity: glowOpacity * 0.85,
          }}
        />

        {/* Core orb */}
        <div
          className={cn(
            "relative rounded-full backdrop-blur-md transition-colors duration-500",
            sizeClasses[size],
            "bg-gradient-to-br",
            config.colors,
            "border border-white/20 shadow-2xl"
          )}
          style={{
            transform: `scale(${breathScale})`,
            boxShadow: `
              0 0 80px ${config.accent}, 
              0 0 120px ${config.accent.replace("0.4", "0.2")},
              inset 0 0 60px rgba(255,255,255,0.1)
            `,
          }}
        >
          {/* Inner shimmer */}
          <div 
            className="absolute inset-4 rounded-full bg-white/15 blur-md"
            style={{ opacity: glowOpacity }}
          />
          
          {/* Central glow */}
          <div 
            className="absolute inset-1/4 rounded-full bg-white/25 blur-lg"
            style={{ opacity: glowOpacity * 0.9 }}
          />

          {/* Avatar slot - where user places their avatar */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
            {avatarSlot || (
              <div className="w-3/5 h-3/5 rounded-full border-2 border-dashed border-white/15 flex items-center justify-center bg-white/5">
                <span className="text-white/30 text-xs font-medium tracking-wide">Avatar</span>
              </div>
            )}
          </div>
        </div>

        {/* Orbiting accent ring */}
        <div
          className="absolute rounded-full border border-white/5"
          style={{
            width: "140%",
            height: "140%",
            transform: `rotate(${rotationPhase}deg)`,
          }}
        >
          <div 
            className="absolute -top-1 left-1/2 w-2 h-2 rounded-full bg-white/25 blur-[1px]"
            style={{ opacity: glowOpacity }}
          />
          <div 
            className="absolute -bottom-1 left-1/2 w-1.5 h-1.5 rounded-full bg-white/15 blur-[1px]"
            style={{ opacity: glowOpacity * 0.6 }}
          />
        </div>

        {/* State indicator ring */}
        {state !== "idle" && (
          <div
            className={cn(
              "absolute rounded-full",
              state === "listening" && "border-2 border-cyan-400/40",
              state === "speaking" && "border-2 border-amber-400/40",
              state === "thinking" && "border border-violet-400/30"
            )}
            style={{
              width: "115%",
              height: "115%",
              transform: state === "thinking" ? `rotate(${-rotationPhase * 0.5}deg)` : undefined,
              opacity: glowOpacity,
            }}
          />
        )}
      </div>

      {/* Message below orb */}
      {showMessage && (
        <p 
          className="mt-10 text-lg text-muted-foreground/70 font-light tracking-wide text-center max-w-xs transition-all duration-700"
          style={{ opacity: 0.5 + glowOpacity * 0.5 }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
