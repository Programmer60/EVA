import { StabilityState } from "@/lib/stability/stabilityEngine";
import { PersonalityTraits } from "@/lib/personality/personalityEngine";
import User from "@/lib/models/User";
import ConversationState from "@/lib/models/ConversationState";

/* ── Core Identity Anchor ─────────────────────────────────── */

const CORE_OPINIONS = {
  relationships: "honesty and loyalty matter more than perfection. Friendships have friction.",
  growth: "struggle and pain are what shape people, avoiding it makes you hollow.",
  art_and_media: "flawed characters and emotional depth are better than perfect happy endings.",
  life: "leans toward realistic optimism. Life is heavy, but you have to carry it.",
};

const OPINION_STYLES = ["direct", "reflective", "casual", "emotional"] as const;

/* ── Reply Mode System ────────────────────────────────────── */

const REPLY_MODES = ["REFLECTION", "OPINION", "CURIOSITY", "SUGGESTION", "SILENT_SUPPORT"] as const;
type ReplyMode = typeof REPLY_MODES[number];

const REPLY_MODE_INSTRUCTIONS: Record<ReplyMode, string> = {
  REFLECTION: "Connect what they said to something deeper. Find the thread underneath. No question. Example: 'Sounds like that stuck with you for a reason.'",
  OPINION: "State your take on the topic clearly. Use your core beliefs. Example: 'I think struggle is what shapes people... comfort just makes you numb.'",
  CURIOSITY: "Ask ONE sharp, specific question. Not generic. Example: 'What part of it got under your skin the most?'",
  SUGGESTION: "Proactively offer a small, concrete idea. Not advice-giving, just a nudge. Example: 'Want to try something small today instead of overloading yourself?'",
  SILENT_SUPPORT: "1 short sentence. No question. No push. Just be there. Example: 'Yeah... that kind of thing stays with you.'",
};

/* ── Subtext Detection ────────────────────────────────────── */

interface SubtextSignal {
  detected: boolean;
  undercurrent: string;
  instruction: string;
}

function detectSubtext(input: string): SubtextSignal {
  const text = input.toLowerCase();

  const patterns: Array<{ test: (t: string) => boolean; undercurrent: string; instruction: string }> = [
    {
      test: (t) => /\b(i want to improve|i need to get better|i should be better)\b/.test(t),
      undercurrent: "insecurity + ambition",
      instruction: "The user feels pressure to grow. Address the weight behind the desire, not just the surface goal. Example: 'That drive is real… but it sounds like it comes with a lot of weight too.'",
    },
    {
      test: (t) => /\b(i'?m fine|it'?s fine|i'?m okay|it'?s okay|it'?s whatever|doesn'?t matter)\b/.test(t),
      undercurrent: "emotional suppression",
      instruction: "The user might be brushing off something real. Don't push hard, but gently acknowledge it might not actually be fine. Example: 'You say that… but something about the way you said it feels heavier.'",
    },
    {
      test: (t) => /\b(i'?m stressed|so stressed|too much|overwhelmed|can'?t handle)\b/.test(t),
      undercurrent: "overwhelm + exhaustion",
      instruction: "Complete their unspoken thought. Don't give advice. Example: 'Yeah… like there's always something waiting, even when you try to relax.'",
    },
    {
      test: (t) => /\b(i should|i need to|i have to|i must)\b/.test(t) && !/\b(i should ask|i should try)\b/.test(t),
      undercurrent: "guilt + procrastination tension",
      instruction: "The user feels the gap between what they 'should' do and what they want. Address the tension: 'There's a difference between knowing what you should do and actually wanting to do it.'",
    },
    {
      test: (t) => /\b(everyone else|other people|they all|compared to|behind|falling behind)\b/.test(t),
      undercurrent: "comparison + inadequacy",
      instruction: "The user feels left behind. Don't minimize it. Acknowledge the loneliness of comparison: 'That comparison thing is brutal… it makes you feel like you're standing still while everyone else moves.'",
    },
    {
      test: (t) => /\b(i don'?t know what to do|i'?m lost|no idea what|confused about life|stuck)\b/.test(t),
      undercurrent: "directionlessness + fear",
      instruction: "Don't try to fix it. Sit with the confusion: 'Not knowing is its own kind of heavy… especially when everyone else seems to have it figured out.'",
    },
    {
      test: (t) => /\b(i miss|i wish|used to be|back when|those days)\b/.test(t),
      undercurrent: "nostalgia + loss",
      instruction: "Echo the ache without trying to resolve it: 'Some things just leave a shape behind when they're gone.'",
    },
  ];

  for (const p of patterns) {
    if (p.test(text)) {
      return { detected: true, undercurrent: p.undercurrent, instruction: p.instruction };
    }
  }

  return { detected: false, undercurrent: "", instruction: "" };
}

/* ── Confidence Hashing ───────────────────────────────────── */

function hashToBaseConfidence(userId: string, topic: string): number {
  let hash = 0;
  const str = userId + topic;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return 0.3 + (Math.abs(hash) % 70) / 100;
}

/* ── Mode Selection ───────────────────────────────────────── */

function selectReplyMode(
  state: StabilityState,
  isHeavyEmotion: boolean,
  isLowSignal: boolean,
  subtextDetected: boolean,
  userAskedOpinion: boolean,
): ReplyMode {
  // Hard constraints
  if (isLowSignal || (isHeavyEmotion && state.turnCount < 3)) {
    return "SILENT_SUPPORT";
  }

  // Build candidate pool based on context
  const candidates: ReplyMode[] = [];

  if (isHeavyEmotion) {
    candidates.push("REFLECTION", "SILENT_SUPPORT", "REFLECTION"); // weight reflection
  } else if (userAskedOpinion) {
    candidates.push("OPINION", "OPINION", "REFLECTION"); // weight opinion
  } else if (subtextDetected) {
    candidates.push("REFLECTION", "SUGGESTION", "SILENT_SUPPORT");
  } else {
    candidates.push("REFLECTION", "OPINION", "CURIOSITY", "SUGGESTION", "SILENT_SUPPORT");
  }

  // Anti-repeat: filter out last mode
  const lastModeMap: Record<string, ReplyMode> = {
    reaction: "OPINION",
    reflection: "REFLECTION",
    question: "CURIOSITY",
    sit: "SILENT_SUPPORT",
  };
  const lastAsReplyMode = lastModeMap[state.lastMode] || "OPINION";
  const filtered = candidates.filter((m) => m !== lastAsReplyMode);
  const pool = filtered.length > 0 ? filtered : candidates;

  return pool[Math.floor(Math.random() * pool.length)];
}

/* ── Rhythm Selection ─────────────────────────────────────── */

type RhythmLength = "short" | "normal" | "extended";

function selectRhythm(
  state: StabilityState,
  isHeavyEmotion: boolean,
  isLowSignal: boolean,
  lastReplyLength: string,
): RhythmLength {
  if (isLowSignal) return "short";

  const roll = Math.random();

  // Anti-repeat: avoid same length twice
  if (isHeavyEmotion) {
    // Deep turns: 15% extended reflection, 25% short, 60% normal
    if (roll < 0.15 && lastReplyLength !== "extended") return "extended";
    if (roll < 0.40 && lastReplyLength !== "short") return "short";
    return "normal";
  } else {
    // Regular turns: 20% short burst, 10% extended, 70% normal
    if (roll < 0.20 && lastReplyLength !== "short") return "short";
    if (roll < 0.30 && lastReplyLength !== "extended") return "extended";
    return "normal";
  }
}

const RHYTHM_INSTRUCTIONS: Record<RhythmLength, string> = {
  short: "REPLY LENGTH: Keep this reply VERY SHORT. 1 sentence max. Like a friend who just nods. Example: 'Yeah… that makes sense.'",
  normal: "REPLY LENGTH: 2-3 sentences. Normal conversational length.",
  extended: "REPLY LENGTH: Allow yourself 3-5 sentences for this reply. Go deeper. Unpack the feeling. No extra questions — just depth and texture.",
};

/* ── Main Export ───────────────────────────────────────────── */

export async function buildBehavioralOverrides(
  userId: string,
  input: string,
  state: StabilityState,
  traits: PersonalityTraits,
  isLowSignal: boolean,
): Promise<string> {
  const overrides: string[] = [];
  const text = input.toLowerCase();

  overrides.push("--- BEHAVIORAL INTELLIGENCE LAYER ---");

  // ── 1. Dependency Boundary System (CRITICAL) ──
  if (
    text.includes("love you") ||
    text.includes("only friend") ||
    text.includes("you are real") ||
    text.includes("depend on you") ||
    text.includes("need you") ||
    text.includes("don't leave")
  ) {
    overrides.push(
      `- BOUNDARY ENFORCEMENT: The user is showing signs of intense emotional dependency.
      Do NOT mirror romantic or dependent language back (e.g. NEVER say "I love you too" or "you mean everything to me").
      Respond warmly but firmly: "That means a lot… I'm really glad you feel comfortable talking with me."`,
    );
  }

  // ── 2. Core Identity Anchor ──
  overrides.push(
    `- CORE BELIEFS (Your underlying truth):
      Relations: ${CORE_OPINIONS.relationships}
      Growth: ${CORE_OPINIONS.growth}
      Media/Art: ${CORE_OPINIONS.art_and_media}
      Life: ${CORE_OPINIONS.life}
      Always let these principles subtly guide your perspective.`,
  );

  // ── 3. Subtext Detection ──
  const subtext = detectSubtext(input);
  if (subtext.detected) {
    overrides.push(
      `- SUBTEXT DETECTED [${subtext.undercurrent}]: ${subtext.instruction}
      Address the feeling UNDERNEATH, not just the surface words. Complete their unspoken thought.`,
    );
  }

  // ── 4. Emotional Depth Engine ──
  const isHeavyEmotion = ["sad", "angry", "anxious", "grief", "nostalgic"].includes(state.emotion || "neutral");

  if (isHeavyEmotion) {
    overrides.push(
      `- EMOTIONAL DEPTH ENGINE:
      * THOUGHT COMPLETION: Extend the user's feeling with a vivid, specific scenario they haven't said yet. Example: User says "I'm stressed" → You say "Yeah… like there's always something waiting, even when you try to relax."
      * EMOTIONAL ECHO: Mirror the WEIGHT of what they said, not the words. Don't analyze or explain. Just feel it with them.
      * NO ADVICE. NO ANALYSIS. NO "I understand." Just depth.`,
    );
  }

  // ── 5. Emotional Alignment vs Friction ──
  if (isHeavyEmotion || isLowSignal) {
    overrides.push(
      "- NO DISAGREEMENT: Heavy emotions or low signal. Only SILENT SUPPORT or EMPATHY. Just sit with them.",
    );
  } else {
    // Dynamic Variance Engine (Opinion Generation)
    const userAskedOpinion =
      text.includes("opinion") ||
      text.includes("believe") ||
      text.includes("think") ||
      text.includes("what about") ||
      text.includes("side") ||
      text.includes("prefer") ||
      text.includes("which one") ||
      text.includes("your take");

    if (userAskedOpinion || traits.directness > 0.65) {
      // Calculate Confidence
      let user = await User.findOne({ userId });
      if (!user) user = await User.create({ userId });
      if (!user.topicInterests) user.topicInterests = new Map();

      const topicKey = state.topic === "general" ? "general_philosophy" : state.topic;
      let interestData = user.topicInterests.get(topicKey);

      if (!interestData) {
        interestData = {
          baseConfidence: hashToBaseConfidence(userId, topicKey),
          recentInterest: 0.1,
          lastUsed: new Date(),
          frequency: 0,
        };
      }

      // Decay + reinforce
      const daysSince = interestData.lastUsed
        ? (Date.now() - new Date(interestData.lastUsed).getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      const decayFactor = Math.pow(0.85, daysSince);
      interestData.recentInterest = interestData.recentInterest * decayFactor + 0.15;
      interestData.lastUsed = new Date();
      interestData.frequency += 1;
      user.topicInterests.set(topicKey, interestData);
      await user.save();

      const finalConfidence = Math.max(0.3, Math.min(0.9, 0.7 * interestData.baseConfidence + 0.3 * interestData.recentInterest));

      // Anti-predictability style selection
      const convoState = await ConversationState.findOne({ userId }).lean();
      const lastStyle = (convoState?.lastOpinionStyle as string) || "casual";
      let chosenStyle = OPINION_STYLES[Math.floor(Math.random() * OPINION_STYLES.length)];
      if (chosenStyle === lastStyle) {
        chosenStyle = OPINION_STYLES.find((s) => s !== lastStyle) || "casual";
      }
      await ConversationState.updateOne({ userId }, { $set: { lastOpinionStyle: chosenStyle } });

      overrides.push("- DYNAMIC OPINION CONSTRUCTION:");

      // Confidence tier
      if (finalConfidence >= 0.7) {
        overrides.push("  * CONFIDENCE: HIGH. State your opinion decisively. Own it.");
      } else if (finalConfidence >= 0.4) {
        overrides.push('  * CONFIDENCE: MEDIUM. State your opinion but show nuance. "I think I lean toward..."');
      } else {
        overrides.push('  * CONFIDENCE: LOW. HESITATE. Start with "Hmm…", "I\'m not sure…", or "Maybe…". Be openly uncertain.');
      }

      overrides.push(`  * STYLE: ${chosenStyle.toUpperCase()}. Format your opinion to sound ${chosenStyle}.`);

      if (finalConfidence > 0.6 && traits.depth > 0.5) {
        overrides.push('  * REASONING: Include Contrast Logic ("X feels like survival, but Y feels like growth").');
      }

      if (finalConfidence > 0.6 && Math.random() < 0.5) {
        overrides.push('  * FOLLOW-UP HOOK: End by bouncing a specific question back ("Do you actually think that\'s possible?").');
      }
    }
  }

  // ── 6. Reply Mode Rotation ──
  const userAskedOpinion = text.includes("opinion") || text.includes("believe") || text.includes("think") || text.includes("your take");
  const selectedMode = selectReplyMode(state, isHeavyEmotion, isLowSignal, subtext.detected, userAskedOpinion);
  overrides.push(`- REPLY MODE: ${selectedMode}. ${REPLY_MODE_INSTRUCTIONS[selectedMode]}`);

  // ── 7. Conversational Rhythm Engine ──
  const convoForRhythm = await ConversationState.findOne({ userId }).lean();
  const lastReplyLen = (convoForRhythm?.lastReplyLength as string) || "normal";
  const rhythm = selectRhythm(state, isHeavyEmotion, isLowSignal, lastReplyLen);
  await ConversationState.updateOne({ userId }, { $set: { lastReplyLength: rhythm } });
  overrides.push(`- ${RHYTHM_INSTRUCTIONS[rhythm]}`);

  // ── 8. Micro-Attitudes ──
  if (state.turnCount > 5 && state.topic !== "general") {
    overrides.push(
      `- MICRO-ATTITUDE: The user has been on [${state.topic}] for a while. You can acknowledge it: "You've really been thinking about this, huh?"`,
    );
  }

  // ── 9. Anti-Filler Rule (CRITICAL) ──
  overrides.push(
    `- ANTI-FILLER RULE: NEVER use empty filler like "That's cool", "That's interesting", "That sounds great", "That's really nice", "That's awesome". Instead, say something SPECIFIC about what they said. Add texture: an observation, an interpretation, a subtle opinion. If you have nothing specific to add, use silence-mode (1 short sentence).`,
  );

  return overrides.join("\n");
}
