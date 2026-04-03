/**
 * presenceEngine.ts — Pure logic module for EVA's Emotional Presence Layer.
 *
 * Controls:
 *  - How long EVA "thinks" before replying (typing delay)
 *  - How the reply is chunked into sentence-level pieces
 *  - How long each chunk takes to appear (inter-chunk delay)
 *  - Micro-variability to prevent robotic timing patterns
 */

/* ── Types ────────────────────────────────────────────────── */

export interface PresenceChunk {
  text: string;
  /** Milliseconds to wait AFTER this chunk is rendered before showing the next one */
  delayAfter: number;
  /** Whether this chunk represents a [pause] marker (no visible text) */
  isPause: boolean;
}

/* ── Emotion Multipliers ──────────────────────────────────── */

const EMOTION_FACTORS: Record<string, number> = {
  sad: 1.4,
  anxious: 1.3,
  nostalgic: 1.3,
  concerned: 1.2,
  empathetic: 1.2,
  angry: 1.1,
  neutral: 1.0,
  curious: 0.95,
  happy: 0.85,
  excited: 0.7,
};

function getEmotionFactor(emotion: string): number {
  return EMOTION_FACTORS[emotion] ?? 1.0;
}

/* ── Micro-Variability ────────────────────────────────────── */

/** Add ±jitterPercent random noise to a value */
function jitter(value: number, jitterPercent = 0.15): number {
  const range = value * jitterPercent;
  const offset = (Math.random() * 2 - 1) * range; // random between -range and +range
  return Math.max(0, Math.round(value + offset));
}

/* ── Typing Delay (THINKING phase) ────────────────────────── */

const TYPING_DELAY_BASE_PER_CHAR = 14; // ms per character
const TYPING_DELAY_MIN = 800; // minimum thinking time (visible pause)
const TYPING_DELAY_MAX = 2500; // cap at 2.5s

/**
 * Compute how long EVA "thinks" before starting to type.
 * Longer replies and heavier emotions = longer thinking.
 */
export function getTypingDelay(text: string, emotion: string): number {
  const base = text.length * TYPING_DELAY_BASE_PER_CHAR;
  const factor = getEmotionFactor(emotion);
  const scaled = base * factor;
  const clamped = Math.max(TYPING_DELAY_MIN, Math.min(TYPING_DELAY_MAX, scaled));
  return jitter(clamped);
}

/* ── Chunk Delay (between sentence chunks) ────────────────── */

const CHUNK_DELAY_BASE = 400; // ms base between chunks (visible gap)
const CHUNK_DELAY_PER_CHAR = 10; // ms per character in the chunk
const CHUNK_DELAY_MAX = 1500;
const PAUSE_DELAY_MIN = 800;
const PAUSE_DELAY_MAX = 1400;

/**
 * Compute the delay after rendering a specific chunk.
 */
export function getChunkDelay(chunkText: string, emotion: string): number {
  const base = CHUNK_DELAY_BASE + chunkText.length * CHUNK_DELAY_PER_CHAR;
  const factor = getEmotionFactor(emotion);
  const scaled = base * factor;
  const clamped = Math.min(CHUNK_DELAY_MAX, scaled);
  return jitter(clamped);
}

/* ── Reply Chunking ───────────────────────────────────────── */

/**
 * Split a reply into sentence-level chunks with computed delays.
 * Handles [pause] markers as explicit delay-only chunks.
 */
export function chunkReply(text: string, emotion: string): PresenceChunk[] {
  const chunks: PresenceChunk[] = [];

  // First, split on [pause] markers
  const pauseSegments = text.split(/\[pause\]/gi);

  for (let i = 0; i < pauseSegments.length; i++) {
    const segment = pauseSegments[i].trim();

    if (segment.length > 0) {
      // Split this segment into sentences
      const sentences = segment.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [segment];

      for (let j = 0; j < sentences.length; j++) {
        const sentence = sentences[j].trim();
        if (!sentence) continue;

        const isLastSentenceInSegment = j === sentences.length - 1;
        const isLastSegment = i === pauseSegments.length - 1;
        const isVeryLast = isLastSentenceInSegment && isLastSegment;

        chunks.push({
          text: sentence,
          delayAfter: isVeryLast ? 0 : getChunkDelay(sentence, emotion),
          isPause: false,
        });
      }
    }

    // If there's a [pause] after this segment (not the last segment), add a pause chunk
    if (i < pauseSegments.length - 1) {
      const pauseDelay = jitter(
        PAUSE_DELAY_MIN + Math.random() * (PAUSE_DELAY_MAX - PAUSE_DELAY_MIN),
      );
      chunks.push({
        text: "",
        delayAfter: pauseDelay,
        isPause: true,
      });
    }
  }

  // If we somehow got 0 chunks, just return the whole thing
  if (chunks.length === 0 && text.trim()) {
    chunks.push({ text: text.trim(), delayAfter: 0, isPause: false });
  }

  return chunks;
}

/**
 * Utility: sleep for a given number of milliseconds.
 * Returns an AbortController-aware promise that rejects on abort.
 */
export function presenceSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
