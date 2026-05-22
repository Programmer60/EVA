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

  /* ── Audio Element Mode (Server TTS) ────────────────────── */

  connectToAudioElement(audio: HTMLAudioElement): void {
    this.disconnect();
    this.mode = "analyser";

    try {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;

      this.source = this.audioContext.createMediaElementSource(audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
    } catch {
      // Web Audio API not available — fall back to simulation
      this.startSimulation();
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
      this.amplitude = Math.min(1, rms * 3.5);

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
      try { this.source.disconnect(); } catch { /* already disconnected */ }
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* already disconnected */ }
      this.analyser = null;
    }
    if (this.audioContext) {
      try { void this.audioContext.close(); } catch { /* already closed */ }
      this.audioContext = null;
    }
    this.dataArray = null;
  }
}
