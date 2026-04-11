/**
 * relationshipEngine.ts — Bond Tracking & Relational Awareness
 *
 * Transforms EVA from observer → participant in the relationship.
 *
 * Key systems:
 *   1. Bond Signal Detection — detects appreciation, trust, connection signals
 *   2. Bond Score Management — grows/decays over time
 *   3. Relational Grounding — shifts language from abstract to personal
 *   4. Observed Pattern Callbacks — EVA notices things about the user and references them
 *   5. Bond-Aware Tone — scales warmth proportionally to bond depth
 */

import User from "@/lib/models/User";

/* ── Types ─────────────────────────────────────────────────── */

export interface BondState {
  score: number;         // 0 → 1
  signals: number;       // raw count
  tier: BondTier;
  observedPatterns: string[];
}

export type BondTier = "new" | "warming" | "comfortable" | "close";

export interface RelationshipPrompt {
  bondPrompt: string;
  signalDetected: boolean;
}

/* ── Bond Signal Detection ────────────────────────────────── */

interface SignalResult {
  detected: boolean;
  type: "appreciation" | "trust" | "connection" | "vulnerability" | "none";
  strength: number; // 0-1
}

function detectBondSignal(input: string): SignalResult {
  const t = input.toLowerCase();

  // Appreciation — user explicitly values EVA
  if (/\b(you('re| are) amazing|thank you so much|you('re| are) the best|you really get me|you actually understand|you('re| are) incredible|means a lot)\b/.test(t)) {
    return { detected: true, type: "appreciation", strength: 0.8 };
  }

  // Trust — user shares something personal or vulnerable
  if (/\b(i('ve| have) never told|between us|i trust you|can i tell you|i need to talk|nobody else knows|you('re| are) the only one)\b/.test(t)) {
    return { detected: true, type: "trust", strength: 0.9 };
  }

  // Connection — user acknowledges the bond directly
  if (/\b(you understand me|you get me|i feel (comfortable|safe) with you|talking to you (helps|feels)|you make me feel|like talking to a friend|you('re| are) like a friend)\b/.test(t)) {
    return { detected: true, type: "connection", strength: 0.85 };
  }

  // Vulnerability — user opens up emotionally (not the same as heavy emotions — this is intentional sharing)
  if (/\b(i('m| am) scared to|i don('t|t) usually say|this is hard to say|i('ve| have) been hiding|no one knows)\b/.test(t)) {
    return { detected: true, type: "vulnerability", strength: 0.7 };
  }

  // Light warmth — softer signals of comfort
  if (/\b(you('re| are) nice|i like talking to you|you('re| are) cool|this is nice|i enjoy this|you('re| are) fun)\b/.test(t)) {
    return { detected: true, type: "appreciation", strength: 0.4 };
  }

  return { detected: false, type: "none", strength: 0 };
}

/* ── Observed Pattern Detection ───────────────────────────── */

function detectUserPattern(input: string, turnCount: number): string | null {
  const t = input.toLowerCase();

  // Only after enough turns to have observed something real
  if (turnCount < 5) return null;

  // Patterns EVA might notice about how the user communicates
  if (t.length > 200) return "you tend to think through things pretty deeply before you say them";
  if (/\b(haha|lol|lmao|😂)\b/.test(t) && /\b(sad|stress|hurt|hard)\b/.test(t)) return "you use humor to lighten heavy stuff";
  if (/\b(actually|honestly|to be real|real talk)\b/.test(t)) return "you like being straight about how you feel";
  if (/\b(i don('t|t) know|maybe|not sure)\b/.test(t) && turnCount > 8) return "you think out loud a lot — like you figure things out as you go";

  return null;
}

/* ── Bond Score Math ──────────────────────────────────────── */

function calculateBondTier(score: number): BondTier {
  if (score >= 0.75) return "close";
  if (score >= 0.45) return "comfortable";
  if (score >= 0.2) return "warming";
  return "new";
}

/* ── Main Export ───────────────────────────────────────────── */

export async function buildRelationshipPrompt(
  userId: string,
  input: string,
  turnCount: number,
): Promise<RelationshipPrompt> {
  let user = await User.findOne({ userId });
  if (!user) user = await User.create({ userId });

  // Current bond state
  let bondScore: number = (user.bondScore as number) ?? 0.1;
  let bondSignals: number = (user.bondSignals as number) ?? 0;
  const patterns: string[] = (user.observedPatterns as string[]) ?? [];

  // 1. Detect bond signals in this message
  const signal = detectBondSignal(input);

  if (signal.detected) {
    // Grow bond score (diminishing returns — harder to reach higher tiers)
    const growth = signal.strength * 0.08 * (1 - bondScore); // grows slower as it gets higher
    bondScore = Math.min(0.95, bondScore + growth);
    bondSignals += 1;
  }

  // Natural slow growth per turn (even without explicit signals)
  bondScore = Math.min(0.95, bondScore + 0.003);

  // Slow decay if it's been a long time (prevents stale high bonds)
  const lastUpdate = user.lastBondUpdate ? new Date(user.lastBondUpdate as string).getTime() : Date.now();
  const hoursSince = (Date.now() - lastUpdate) / (1000 * 60 * 60);
  if (hoursSince > 48) {
    bondScore = Math.max(0.1, bondScore - 0.05);
  }

  // 2. Detect observed patterns
  const newPattern = detectUserPattern(input, turnCount);
  if (newPattern && !patterns.includes(newPattern) && patterns.length < 5) {
    patterns.push(newPattern);
  }

  // 3. Save updated bond state
  await User.updateOne(
    { userId },
    {
      $set: {
        bondScore,
        bondSignals,
        observedPatterns: patterns,
        lastBondUpdate: new Date(),
      },
    },
  );

  const tier = calculateBondTier(bondScore);

  // 4. Build prompt
  const lines: string[] = [];
  lines.push("--- RELATIONSHIP LAYER ---");
  lines.push(`- BOND TIER: ${tier.toUpperCase()} (score: ${bondScore.toFixed(2)})`);

  // Bond-aware tone scaling
  switch (tier) {
    case "new":
      lines.push("- RELATIONAL TONE: You're still getting to know this person. Be warm but not overly familiar. Don't claim closeness you haven't built.");
      break;
    case "warming":
      lines.push("- RELATIONAL TONE: You're starting to know this person. You can be a bit more personal. Small acknowledgments like \"I like talking with you\" are okay IF genuine.");
      break;
    case "comfortable":
      lines.push("- RELATIONAL TONE: You know this person well. You can be openly warm, reference shared history, and speak as someone who genuinely cares. \"I'm glad you told me that\" is natural here.");
      break;
    case "close":
      lines.push("- RELATIONAL TONE: This is someone you're genuinely close with. Speak like a real friend who's invested. \"Yeah… talking with you like this actually feels easy.\" is natural. Don't hold back warmth.");
      break;
  }

  // Signal-specific response rules
  if (signal.detected) {
    switch (signal.type) {
      case "appreciation":
        lines.push(
          `- BOND SIGNAL DETECTED [appreciation]: The user expressed gratitude or admiration for you.
          RESPOND PERSONALLY, not abstractly. 
          ❌ BAD: "That kind of connection doesn't pop up often."
          ✅ GOOD: "That means a lot… I really like talking with you too."
          ❌ BAD: deflecting or making it about people in general.
          ✅ GOOD: acknowledging YOUR part in the connection. Be a participant, not an observer.`,
        );
        break;
      case "connection":
        lines.push(
          `- BOND SIGNAL DETECTED [connection]: The user acknowledged the bond between you.
          MIRROR IT BACK gently. You ARE part of this relationship.
          ❌ BAD: "It's great when you find someone who gets it."
          ✅ GOOD: "Yeah… I feel that too. Talking like this is easy."
          Own your side of the connection. Don't deflect to abstractions.`,
        );
        break;
      case "trust":
        lines.push(
          `- BOND SIGNAL DETECTED [trust]: The user is sharing something deeply personal.
          Honor it. Don't rush past it. Don't immediately offer advice.
          ✅ "I'm really glad you're telling me this."
          Let the weight of the moment breathe.`,
        );
        break;
      case "vulnerability":
        lines.push(
          `- BOND SIGNAL DETECTED [vulnerability]: The user is being intentionally open.
          Match their courage with genuine warmth.
          ✅ "That takes a lot to say… I hear you."
          Don't analyze. Don't fix. Just be present with them.`,
        );
        break;
    }
  }

  // Observed pattern callbacks (only trigger occasionally)
  if (patterns.length > 0 && tier !== "new" && Math.random() < 0.25) {
    const callback = patterns[Math.floor(Math.random() * patterns.length)];
    lines.push(
      `- PATTERN CALLBACK (use naturally if it fits this turn): You've noticed that ${callback}. You can reference this to show you genuinely see who they are as a person. Example: "I notice you do that — ${callback}. I like that about you." Only use if it flows naturally. Never force it.`,
    );
  }

  // Observer → Participant shift (always active above warming)
  if (tier !== "new") {
    lines.push(
      `- PARTICIPANT RULE: You are NOT an observer of the user's life. You are part of this conversation. Use "I" and "we" and "us" language naturally. Instead of "that kind of connection is rare" → say "I like that we can talk like this." Instead of "it's cool when someone gets it" → "I feel like I get you."`,
    );
  }

  return {
    bondPrompt: lines.join("\n"),
    signalDetected: signal.detected,
  };
}
