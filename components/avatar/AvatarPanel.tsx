"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EvaFace } from "./EvaFace";
import {
  type AvatarExpression,
  type AvatarPresenceState,
  type GazeTarget,
  EMOTION_GLOW,
  PRESENCE_EYE_MOD,
  SPEAKING_MODIFIERS,
  computeGaze,
  getBlinkDuration,
  getExpressionForEmotion,
  getIdleVariation,
  getNextBlinkInterval,
  stepToward,
} from "@/lib/avatar/avatarEngine";
import { LipSyncAnalyzer } from "@/lib/avatar/lipSyncAnalyzer";

/* ── Constants ────────────────────────────────────────────── */

/**
 * Expression transition speed — boosted from 0.045 so emotions
 * are actually readable before they fade. Still smooth, not jarring.
 */
const EXPRESSION_LERP_RATE = 0.07;
/** How fast lip sync drives mouth openness */
const LIP_SYNC_LERP_RATE = 0.25;
/** ms after TTS ends to stay in emotional_pause before returning to idle */
const PAUSE_DURATION = 2200;
/** ms of inactivity before switching from listening to idle */
const IDLE_TIMEOUT = 25000;

export function AvatarPanel() {
  /* ── State ──────────────────────────────────────────────── */
  const [presenceState, setPresenceState] = useState<AvatarPresenceState>("idle");

  /* ── Refs for animation loop (avoid React re-renders per frame) ── */
  const currentExprRef = useRef<AvatarExpression>(getExpressionForEmotion("neutral"));
  const targetExprRef = useRef<AvatarExpression>(getExpressionForEmotion("neutral"));
  const gazeRef = useRef<GazeTarget>({ x: 0, y: 0 });
  const mouthRef = useRef(0);
  const isBlinkingRef = useRef(false);
  const presenceRef = useRef<AvatarPresenceState>("idle");
  const lipSyncRef = useRef(new LipSyncAnalyzer());
  const isSpeakingRef = useRef(false);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── Cursor gaze tracking ───────────────────────────────── */
  const cursorGazeRef = useRef<GazeTarget | null>(null);

  /* ── Rendered state (updated ~30fps from RAF) ───────────── */
  const [renderedExpr, setRenderedExpr] = useState<AvatarExpression>(
    getExpressionForEmotion("neutral"),
  );
  const [renderedGaze, setRenderedGaze] = useState<GazeTarget>({ x: 0, y: 0 });
  const [renderedBlink, setRenderedBlink] = useState(false);
  const [renderedSpeaking, setRenderedSpeaking] = useState(false);
  const [renderedBreathe, setRenderedBreathe] = useState(1);
  const [renderedBrowDrift, setRenderedBrowDrift] = useState(0);
  const [renderedHeadDrift, setRenderedHeadDrift] = useState(0);
  const [ambientGlow, setAmbientGlow] = useState(EMOTION_GLOW.neutral);

  /* ── Presence State Machine ─────────────────────────────── */

  const setPresence = useCallback((state: AvatarPresenceState) => {
    presenceRef.current = state;
    setPresenceState(state);
    lastActivityRef.current = Date.now();

    // Reset idle timeout
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (state === "listening") {
      idleTimerRef.current = setTimeout(() => {
        if (presenceRef.current === "listening") {
          presenceRef.current = "idle";
          setPresenceState("idle");
        }
      }, IDLE_TIMEOUT);
    }
  }, []);

  const enterEmotionalPause = useCallback(() => {
    setPresence("emotional_pause");
    isSpeakingRef.current = false;
    lipSyncRef.current.disconnect();

    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      setPresence("listening");
    }, PAUSE_DURATION);
  }, [setPresence]);

  /* ── Settling Blink ─────────────────────────────────────── */
  /**
   * A deliberate blink that fires when EVA enters "thinking" state.
   * Creates perceived thoughtfulness — like a person closing their eyes
   * briefly before considering their response.
   */
  const triggerSettlingBlink = useCallback(() => {
    // Slightly longer than normal blink — this is a "settling in" moment
    isBlinkingRef.current = true;
    setRenderedBlink(true);
    setTimeout(() => {
      isBlinkingRef.current = false;
      setRenderedBlink(false);
    }, 250); // 250ms — noticeably longer than regular 130-200ms blinks
  }, []);

  /* ── Blink Scheduler ────────────────────────────────────── */

  const scheduleBlink = useCallback(() => {
    if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);

    const interval = getNextBlinkInterval(presenceRef.current);
    blinkTimerRef.current = setTimeout(() => {
      isBlinkingRef.current = true;
      setRenderedBlink(true);

      const duration = getBlinkDuration(presenceRef.current);
      setTimeout(() => {
        isBlinkingRef.current = false;
        setRenderedBlink(false);
        scheduleBlink();
      }, duration);
    }, interval);
  }, []);

  /* ── Cursor Tracking (mousemove → normalized gaze) ──────── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onMouseMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.4; // face is slightly above center

      // Normalize to -1..1 range, clamped
      // Use viewport-relative distance so cursor far away has weak effect
      const rawX = (e.clientX - centerX) / (window.innerWidth * 0.5);
      const rawY = (e.clientY - centerY) / (window.innerHeight * 0.5);

      cursorGazeRef.current = {
        x: Math.max(-1, Math.min(1, rawX * 0.8)),
        y: Math.max(-1, Math.min(1, rawY * 0.6)),
      };
    }

    function onMouseLeave() {
      // When cursor leaves window, fade back to autonomous gaze
      cursorGazeRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  /* ── Event Listeners ────────────────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Listen for emotion changes from ChatPanel
    function onAssistantReply(event: Event) {
      const detail = (event as CustomEvent).detail as {
        emotion?: string;
      } | undefined;
      const newEmotion = detail?.emotion ?? "neutral";
      targetExprRef.current = getExpressionForEmotion(newEmotion);
      setAmbientGlow(EMOTION_GLOW[newEmotion] ?? EMOTION_GLOW.neutral);
    }

    // Listen for presence phase changes from ChatPanel
    function onPresenceChange(event: Event) {
      const detail = (event as CustomEvent).detail as {
        phase?: string;
      } | undefined;
      const phase = detail?.phase;

      if (phase === "thinking") {
        setPresence("thinking");
        // Settling blink: EVA closes eyes briefly, then opens with downward gaze
        // Creates the "let me think about that" moment
        triggerSettlingBlink();
      } else if (phase === "streaming") {
        setPresence("speaking");
      } else if (phase === "idle") {
        // Only move to listening if we're not already in speaking (TTS might still be playing)
        if (!isSpeakingRef.current && presenceRef.current !== "emotional_pause") {
          setPresence("listening");
        }
      }
    }

    // Listen for TTS lifecycle events
    function onTtsStart(event: Event) {
      const detail = (event as CustomEvent).detail as {
        mode?: string;
        audio?: HTMLAudioElement;
      } | undefined;

      isSpeakingRef.current = true;
      setPresence("speaking");

      if (detail?.mode === "server" && detail.audio) {
        lipSyncRef.current.connectToAudioElement(detail.audio);
      } else {
        lipSyncRef.current.startSimulation();
      }
    }

    function onTtsEnd() {
      enterEmotionalPause();
    }

    function onTtsWordBoundary() {
      lipSyncRef.current.onWordBoundary();
    }

    window.addEventListener("eva:assistant-reply", onAssistantReply as EventListener);
    window.addEventListener("eva:presence-change", onPresenceChange as EventListener);
    window.addEventListener("eva:tts-start", onTtsStart as EventListener);
    window.addEventListener("eva:tts-end", onTtsEnd as EventListener);
    window.addEventListener("eva:tts-word-boundary", onTtsWordBoundary as EventListener);

    return () => {
      window.removeEventListener("eva:assistant-reply", onAssistantReply as EventListener);
      window.removeEventListener("eva:presence-change", onPresenceChange as EventListener);
      window.removeEventListener("eva:tts-start", onTtsStart as EventListener);
      window.removeEventListener("eva:tts-end", onTtsEnd as EventListener);
      window.removeEventListener("eva:tts-word-boundary", onTtsWordBoundary as EventListener);
    };
  }, [setPresence, enterEmotionalPause, triggerSettlingBlink]);

  /* ── Animation Loop (~30fps throttled) ──────────────────── */

  useEffect(() => {
    let rafId: number;
    let lastFrame = 0;
    const FRAME_INTERVAL = 33; // ~30fps

    function animate(timestamp: number) {
      // Throttle to ~30fps
      if (timestamp - lastFrame < FRAME_INTERVAL) {
        rafId = requestAnimationFrame(animate);
        return;
      }
      lastFrame = timestamp;

      const now = performance.now();

      // 1. Build target expression with presence modifiers
      const target = { ...targetExprRef.current };

      // Apply presence-based eye modifier
      const eyeMod = PRESENCE_EYE_MOD[presenceRef.current];
      target.eyeOpenness = Math.max(0.1, Math.min(1, target.eyeOpenness + eyeMod));

      // Speaking state: add subtle cheek warmth (face "warms up" while talking)
      if (isSpeakingRef.current) {
        target.cheekGlow = Math.min(1, target.cheekGlow + SPEAKING_MODIFIERS.cheekGlowBoost);
      }

      // 2. Smoothly interpolate expression toward target
      currentExprRef.current = stepToward(currentExprRef.current, target, EXPRESSION_LERP_RATE);

      // 3. Lip sync — capped at subtle level, mouth is NOT the focus
      const lipAmplitude = lipSyncRef.current.update();
      const cappedLip = Math.min(lipAmplitude, SPEAKING_MODIFIERS.maxMouthOpenness);
      mouthRef.current += (cappedLip - mouthRef.current) * LIP_SYNC_LERP_RATE;
      currentExprRef.current.mouthOpenness = Math.max(
        currentExprRef.current.mouthOpenness,
        mouthRef.current,
      );

      // 4. Gaze — blends autonomous drift with cursor tracking
      gazeRef.current = computeGaze(presenceRef.current, now, cursorGazeRef.current);

      // 5. Idle micro-variations
      const idle = getIdleVariation(now);

      // 6. Batch update React state (~30fps)
      setRenderedExpr({ ...currentExprRef.current });
      setRenderedGaze({ ...gazeRef.current });
      setRenderedSpeaking(isSpeakingRef.current);
      setRenderedBreathe(idle.breatheScale);
      setRenderedBrowDrift(idle.browDrift);
      setRenderedHeadDrift(idle.headDrift);

      rafId = requestAnimationFrame(animate);
    }

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, []);

  /* ── Start blink cycle on mount ─────────────────────────── */
  useEffect(() => {
    scheduleBlink();
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      lipSyncRef.current.disconnect();
    };
  }, [scheduleBlink]);

  /* ── Presence label for UI ──────────────────────────────── */
  // Only show behavioral state. No emotion labels — face + glow communicate that.
  const presenceLabels: Record<AvatarPresenceState, string> = {
    idle: "Present",
    listening: "Present",
    thinking: "Thinking",
    speaking: "Speaking",
    emotional_pause: "Present",
  };

  return (
    <section className="eva-card eva-avatar-card">
      <div className="eva-section-header">
        <h2>EVA</h2>
        <span className="eva-presence-indicator" data-state={presenceState}>
          {presenceLabels[presenceState]}
        </span>
      </div>

      <div
        ref={containerRef}
        className={`eva-avatar-container ${presenceState === "thinking" ? "eva-avatar-thinking" : ""} ${isSpeakingRef.current ? "eva-avatar-speaking" : ""}`}
        style={{
          background: `radial-gradient(circle at 50% 45%, ${ambientGlow}, transparent 70%)`,
        }}
      >
        <div className="eva-face-wrapper">
          <EvaFace
            expression={renderedExpr}
            gaze={renderedGaze}
            isBlinking={renderedBlink}
            isSpeaking={renderedSpeaking}
            breatheScale={renderedBreathe}
            browDrift={renderedBrowDrift}
            headDrift={renderedHeadDrift}
          />
        </div>
      </div>
    </section>
  );
}
