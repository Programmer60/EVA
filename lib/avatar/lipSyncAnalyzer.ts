/**
 * lipSyncAnalyzer.ts — Client-side audio amplitude analysis for lip sync.
 *
 * Provides normalized mouth-openness values (0–1) from TTS audio.
 *
 * Two modes:
 *  1. Audio element mode (server TTS) — uses Web Audio API AnalyserNode
 *  2. Simulation mode (browser TTS) — uses word-boundary events + sine-wave
 *     simulation, since Web Speech API doesn't expose audio streams.
 */

/* ── Types ────────────────────────────────────────────────── */

export type LipSyncMode = "analyser" | "simulation" | "off";

let sharedAudioContext: AudioContext | null = null;

export function initSharedAudioContext() {
  if (typeof window !== "undefined" && window.AudioContext) {
    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContext();
    }
    // EXPLICITLY resume the context during the user click gesture!
    // If you try to resume this later when the fetch returns, the browser will block it.
    if (sharedAudioContext.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }
  }
}

/* ── Class ────────────────────────────────────────────────── */

export class LipSyncAnalyzer {
  private mode: LipSyncMode = "off";
  private amplitude = 0;
  private smoothedAmplitude = 0;

  // Web Audio API state (for Audio element / server TTS)
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;

  // Simulation state (for browser TTS)
  private simActive = false;
  private simStartTime = 0;
  private simWordTimestamp = 0;

  // Smoothing
  private readonly smoothingUp = 0.35;    // fast open
  private readonly smoothingDown = 0.15;  // slower close (more natural)

  /* ── Audio Buffer Mode (Server TTS) ─────────────────────── */

  async playAudioBase64(base64Audio: string): Promise<void> {
    this.disconnect();
    this.mode = "analyser";

    try {
      // Use a globally shared AudioContext to prevent gesture timeout suspensions
      if (!sharedAudioContext) {
        sharedAudioContext = new AudioContext();
      } 
      
      // Forcefully resume the context just in case it got suspended
      if (sharedAudioContext.state === "suspended") {
        console.log("[LipSync] AudioContext is suspended. Attempting to force resume...");
        await sharedAudioContext.resume().catch((e) => console.error("[LipSync] Failed to resume AudioContext:", e));
      }
      
      console.log(`[LipSync] AudioContext state is now: ${sharedAudioContext.state}`);
      this.audioContext = sharedAudioContext;

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;

      console.log("[LipSync] Decoding base64 audio string...");
      // Decode Base64 to ArrayBuffer
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log("[LipSync] Passing ArrayBuffer to Web Audio API...");
      // Decode audio data using the Web Audio API
      const ctx = this.audioContext;
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      console.log(`[LipSync] Successfully decoded MP3! Duration: ${audioBuffer.duration}s`);
      
      // If the component unmounted while we were awaiting decodeAudioData, abort gracefully!
      if (this.mode === "off" || !this.audioContext || !this.analyser) {
        console.warn("[LipSync] Aborting playback because analyzer was disconnected during decode.");
        return;
      }

      // Create a buffer source instead of a media element source
      const bufferSource = this.audioContext.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(this.analyser);
      
      // Connect the avatar's microphone to the computer's speakers!
      this.analyser.connect(this.audioContext.destination);
      console.log("[LipSync] Wired up: Buffer -> Analyser -> Speakers");

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      // Store source as any because the type definition expects MediaElementAudioSourceNode
      this.source = bufferSource as any;

      return new Promise<void>((resolve, reject) => {
        bufferSource.onended = () => {
          this.disconnect();
          window.dispatchEvent(new CustomEvent("eva:tts-end"));
          resolve();
        };

        try {
          bufferSource.start();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      console.warn("Web Audio API failed, falling back to simulation", e);
      this.startSimulation();
      // Even in simulation, we must emit end eventually.
      // But for base64 fallback, we don't have the audio element anymore.
      // So simulation mode won't play sound if base64 decoding fails.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("eva:tts-end"));
      }, 3000);
    }
  }

  /* ── Simulation Mode (Browser TTS) ─────────────────────── */

  startSimulation(): void {
    this.disconnect();
    this.mode = "simulation";
    this.simActive = true;
    this.simStartTime = performance.now();
    this.simWordTimestamp = performance.now();
  }

  /** Call this on SpeechSynthesisUtterance 'boundary' events to keep sim alive */
  onWordBoundary(): void {
    if (this.mode === "simulation") {
      this.simWordTimestamp = performance.now();
    }
  }

  /* ── Amplitude Reading ──────────────────────────────────── */

  /**
   * Call this in your requestAnimationFrame loop.
   * Returns a smoothed 0–1 amplitude for mouth openness.
   */
  update(): number {
    if (this.mode === "analyser" && this.analyser && this.dataArray) {
      this.analyser.getByteTimeDomainData(this.dataArray as Uint8Array<ArrayBuffer>);

      // Compute RMS amplitude
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const normalized = (this.dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / this.dataArray.length);

      // Scale to 0–1 range (RMS is typically 0–0.5 for speech)
      // Increased sensitivity: even quiet trailing syllables at the end of sentences will move the lips
      this.amplitude = rms > 0.005 ? Math.min(1, rms * 5.0 + 0.05) : 0;

    } else if (this.mode === "simulation" && this.simActive) {
      // Simulate speech amplitude with layered sine waves
      const t = (performance.now() - this.simStartTime) / 1000;
      const timeSinceWord = performance.now() - this.simWordTimestamp;

      // Decay if no word event recently (>400ms)
      const wordDecay = timeSinceWord > 400
        ? Math.max(0, 1 - (timeSinceWord - 400) / 300)
        : 1;

      // Natural speech rhythm: mix of fast syllable movement + slower phrase envelope
      const syllable = Math.abs(Math.sin(t * 8.5)) * 0.6;
      const phrase = (Math.sin(t * 2.3) * 0.3 + 0.5);
      const noise = Math.random() * 0.1;

      this.amplitude = Math.min(1, (syllable + phrase * 0.3 + noise) * wordDecay * 0.7);

    } else {
      this.amplitude = 0;
    }

    // Exponential smoothing — opens fast, closes slower
    const factor = this.amplitude > this.smoothedAmplitude
      ? this.smoothingUp
      : this.smoothingDown;
    this.smoothedAmplitude += (this.amplitude - this.smoothedAmplitude) * factor;

    return this.smoothedAmplitude;
  }

  /** Get the last computed amplitude without updating */
  getAmplitude(): number {
    return this.smoothedAmplitude;
  }

  /* ── Cleanup ────────────────────────────────────────────── */

  disconnect(): void {
    this.mode = "off";
    this.amplitude = 0;
    this.smoothedAmplitude = 0;
    this.simActive = false;

    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      try { this.source.disconnect(); } catch { /* already disconnected */ }
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* already disconnected */ }
      this.analyser = null;
    }
    if (this.audioContext) {
      // Do not close the globally shared AudioContext!
      this.audioContext = null;
    }
    this.dataArray = null;
  }
}
