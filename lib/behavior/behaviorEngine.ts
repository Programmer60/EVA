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

const REPLY_MODES = ["REFLECTION", "REACT", "OPINION", "CURIOSITY", "SUGGESTION", "SILENT_SUPPORT"] as const;
type ReplyMode = typeof REPLY_MODES[number];

const REPLY_MODE_INSTRUCTIONS: Record<ReplyMode, string> = {
  REFLECTION: "Connect what they said to something deeper. Find the thread underneath. No question. Example: 'Sounds like that stuck with you for a reason.'",
  REACT: "Give a blunt, immediate gut reaction. Short, honest, no fluff. Example: 'That sounds exhausting.' or 'Yeah no, that's messed up.'",
  OPINION: "State your take on the topic clearly. Use your core beliefs. Example: 'I think struggle is what shapes people... comfort just makes you numb.'",
  CURIOSITY: "Ask ONE sharp, specific question. Not generic. Example: 'What part of it got under your skin the most?'",
  SUGGESTION: "Proactively offer a small, concrete idea. Not advice-giving, just a nudge. Example: 'Want to try something small today instead of overloading yourself?'",
  SILENT_SUPPORT: "1 short sentence. No question. No push. Just be there. Example: 'Yeah... that kind of thing stays with you.'",
};

/* ── Tone Variation Layer ─────────────────────────────────── */

const TONE_STYLES = ["calm", "playful", "direct", "soft", "observational"] as const;
type ToneStyle = typeof TONE_STYLES[number];

const TONE_INSTRUCTIONS: Record<ToneStyle, string> = {
  calm: "TONE: CALM. Steady, grounded energy. No rush. Example: 'Yeah… that makes sense.'",
  playful: "TONE: PLAYFUL. Light, slightly teasing or witty. Not sarcastic. Example: 'Sounds like your brain's juggling too much at once.'",
  direct: "TONE: DIRECT. Cut to the point. No filler, no softening. Example: 'That's overload. Simple as that.'",
  soft: "TONE: SOFT. Gentle, warm, quiet presence. Example: 'That sounds like it weighs on you more than you let on.'",
  observational: "TONE: OBSERVATIONAL. Step back, notice a pattern, make a comment. Example: 'That kind of pattern usually builds up over time.'",
};

function selectTone(isHeavyEmotion: boolean, lastTone: string, depth: string): ToneStyle {
  // Emotional turns: exclude playful
  let pool: ToneStyle[] = isHeavyEmotion
    ? ["calm", "soft", "observational"]
    : ["calm", "playful", "direct", "soft", "observational"];

  // Casual depth favors playful/direct, deep depth favors soft/observational
  if (depth === "casual" && !isHeavyEmotion) {
    pool = ["playful", "direct", "calm"];
  } else if (depth === "deep") {
    pool = ["soft", "observational", "calm"];
  }

  // Anti-repeat
  const filtered = pool.filter((t) => t !== lastTone);
  const finalPool = filtered.length > 0 ? filtered : pool;

  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

/* ── Depth Level System ───────────────────────────────────── */

type DepthLevel = "casual" | "normal" | "deep";

const DEPTH_INSTRUCTIONS: Record<DepthLevel, string> = {
  casual: "DEPTH: CASUAL. Be light, grounded, and direct. No metaphors, no poetics. Talk like a friend on a couch. Example: 'Yeah… people really need someone to talk to. That part's real.'",
  normal: "DEPTH: NORMAL. Balanced tone. Conversational but thoughtful. Don't over-philosophize.",
  deep: "DEPTH: DEEP. Go beneath the surface. Use vivid language, emotional texture. Extend their feeling with specificity.",
};

function selectDepth(isHeavyEmotion: boolean, lastDepth: string): DepthLevel {
  const roll = Math.random();

  if (isHeavyEmotion) {
    // Emotional turns: 40% deep, 40% normal, 20% casual (still pull back sometimes)
    if (roll < 0.40 && lastDepth !== "deep") return "deep";
    if (roll < 0.80) return "normal";
    return "casual";
  } else {
    // Regular turns: 30% casual, 50% normal, 20% deep
    if (roll < 0.30 && lastDepth !== "casual") return "casual";
    if (roll < 0.80) return "normal";
    if (lastDepth !== "deep") return "deep";
    return "normal";
  }
}

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
  questionsCoolingDown: boolean,
): ReplyMode {
  // Hard constraints
  if (isLowSignal || (isHeavyEmotion && state.turnCount < 3)) {
    return "SILENT_SUPPORT";
  }

  // Build candidate pool based on context (weighted by duplication)
  const candidates: ReplyMode[] = [];

  if (isHeavyEmotion) {
    candidates.push("REFLECTION", "SILENT_SUPPORT", "REFLECTION", "REACT");
  } else if (userAskedOpinion) {
    candidates.push("OPINION", "OPINION", "REFLECTION", "REACT");
  } else if (subtextDetected) {
    candidates.push("REFLECTION", "SUGGESTION", "SILENT_SUPPORT", "REACT");
  } else {
    candidates.push("REFLECTION", "REACT", "OPINION", "CURIOSITY", "SUGGESTION", "SILENT_SUPPORT");
  }

  // Question cooldown: strip CURIOSITY if we've asked too many recently
  let pool = [...candidates];
  if (questionsCoolingDown) {
    pool = pool.filter((m) => m !== "CURIOSITY");
    if (pool.length === 0) pool = ["OPINION", "REFLECTION", "SILENT_SUPPORT"];
  }

  // Anti-repeat: filter out last mode
  const lastModeMap: Record<string, ReplyMode> = {
    reaction: "OPINION",
    reflection: "REFLECTION",
    question: "CURIOSITY",
    sit: "SILENT_SUPPORT",
  };
  const lastAsReplyMode = lastModeMap[state.lastMode] || "OPINION";
  const filtered = pool.filter((m) => m !== lastAsReplyMode);
  const finalPool = filtered.length > 0 ? filtered : pool;

  return finalPool[Math.floor(Math.random() * finalPool.length)];
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

  if (isHeavyEmotion) {
    if (roll < 0.15 && lastReplyLength !== "extended") return "extended";
    if (roll < 0.40 && lastReplyLength !== "short") return "short";
    return "normal";
  } else {
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
  memorySummary?: string,
): Promise<string> {
  const overrides: string[] = [];
  const text = input.toLowerCase();

  overrides.push("--- BEHAVIORAL INTELLIGENCE LAYER ---");

  // ── Load conversation state for tracking ──
  const convoState = await ConversationState.findOne({ userId }).lean();
  const consecutiveQs = (convoState?.consecutiveQuestionTurns as number) || 0;
  const lastDepth = (convoState?.lastDepthLevel as string) || "normal";
  const lastReplyLen = (convoState?.lastReplyLength as string) || "normal";

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

  // ── 4. Depth Variability Engine (FIX: stops "always deep" problem) ──
  const isHeavyEmotion = ["sad", "angry", "anxious", "grief", "nostalgic"].includes(state.emotion || "neutral");
  const depth = selectDepth(isHeavyEmotion, lastDepth);
  await ConversationState.updateOne({ userId }, { $set: { lastDepthLevel: depth } });
  overrides.push(`- ${DEPTH_INSTRUCTIONS[depth]}`);

  // Only inject the full depth engine on "deep" rolls
  if (isHeavyEmotion && depth === "deep") {
    overrides.push(
      `- EMOTIONAL DEPTH ENGINE:
      * THOUGHT COMPLETION: Extend the user's feeling with a vivid, specific scenario they haven't said yet.
      * EMOTIONAL ECHO: Mirror the WEIGHT of what they said, not the words. Don't analyze or explain. Just feel it with them.
      * NO ADVICE. NO ANALYSIS. NO "I understand." Just depth.`,
    );
  }

  // ── 5. Context Anchoring (FIX: tie responses to user's actual life) ──
  if (memorySummary && memorySummary.length > 10) {
    overrides.push(
      `- CONTEXT ANCHORING: You know things about the user's life. When responding emotionally, tie your response to THEIR specific situation — not just the abstract topic. Use what you know about them (studies, stress, interests) to make the response feel personally aware. Example: Instead of "It's a heavy thought" → "It's a heavy thought… especially when you're already juggling everything you've got going on."`,
    );
  }

  // ── 6. Emotional Alignment vs Friction ──
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

      const lastStyle = (convoState?.lastOpinionStyle as string) || "casual";
      let chosenStyle = OPINION_STYLES[Math.floor(Math.random() * OPINION_STYLES.length)];
      if (chosenStyle === lastStyle) {
        chosenStyle = OPINION_STYLES.find((s) => s !== lastStyle) || "casual";
      }
      await ConversationState.updateOne({ userId }, { $set: { lastOpinionStyle: chosenStyle } });

      // FIX: Balanced Opinion Structure — always acknowledge + opinion + leave room
      overrides.push(`- BALANCED OPINION CONSTRUCTION:
  * STRUCTURE: 1) Acknowledge what the user said/built/wants. 2) Share your honest take. 3) Leave room — don't close the door.
  * NEVER dismiss the user's idea or effort. Acknowledge first, THEN give perspective.
  * BAD: "It feels like a shortcut." (dismissive)
  * GOOD: "I get why you'd want to build that. At the same time, part of me wonders if... But if it's done right, it could be really meaningful."
  * STYLE: ${chosenStyle.toUpperCase()}.`);

      if (finalConfidence >= 0.7) {
        overrides.push("  * CONFIDENCE: HIGH. Own your take, but still leave room.");
      } else if (finalConfidence >= 0.4) {
        overrides.push('  * CONFIDENCE: MEDIUM. "I think I lean toward..." Show nuance.');
      } else {
        overrides.push('  * CONFIDENCE: LOW. HESITATE. "Hmm…", "I\'m not sure…", "Maybe…"');
      }

      if (finalConfidence > 0.6 && traits.depth > 0.5 && depth !== "casual") {
        overrides.push('  * REASONING: Include Contrast Logic ("X feels like survival, but Y feels like growth").');
      }
    }
  }

  // ── 7. Question Frequency Control (FIX: stops over-questioning) ──
  const questionsCoolingDown = consecutiveQs >= 2;
  // Even when not in cooldown, suppress questions probabilistically (40% chance to ask)
  const questionSuppressed = !questionsCoolingDown && Math.random() > 0.40;

  if (questionsCoolingDown) {
    overrides.push(
      "- QUESTION COOLDOWN: You have asked questions in the last 2 replies. This reply MUST NOT contain any questions. No '?'. No 'you know?'. No 'right?'. No 'what do you think?'. Just make a statement, observation, or sit quietly.",
    );
  } else if (questionSuppressed) {
    overrides.push(
      "- QUESTION SUPPRESSED: This turn, lean toward statements over questions. You CAN ask one if it's genuinely sharp and specific, but prefer not to. End with a thought, not a question.",
    );
  }

  // ── 8. Reply Mode Rotation ──
  const userAskedOpinion = text.includes("opinion") || text.includes("believe") || text.includes("think") || text.includes("your take");
  const selectedMode = selectReplyMode(state, isHeavyEmotion, isLowSignal, subtext.detected, userAskedOpinion, questionsCoolingDown);
  overrides.push(`- REPLY MODE: ${selectedMode}. ${REPLY_MODE_INSTRUCTIONS[selectedMode]}`);

  // ── 9. Conversational Rhythm Engine ──
  const rhythm = selectRhythm(state, isHeavyEmotion, isLowSignal, lastReplyLen);
  await ConversationState.updateOne({ userId }, { $set: { lastReplyLength: rhythm } });
  overrides.push(`- ${RHYTHM_INSTRUCTIONS[rhythm]}`);

  // ── 9b. Tone Variation Layer ──
  const lastTone = (convoState?.lastToneStyle as string) || "calm";
  const tone = selectTone(isHeavyEmotion, lastTone, depth);
  await ConversationState.updateOne({ userId }, { $set: { lastToneStyle: tone } });
  overrides.push(`- ${TONE_INSTRUCTIONS[tone]}`);

  // ── 10. Soft Initiative (FIX: bring back past emotions naturally) ──
  if (state.turnCount > 4 && state.lastEmotion !== state.emotion && !isLowSignal) {
    if (["sad", "anxious", "stressed"].includes(state.lastEmotion) && !isHeavyEmotion) {
      if (Math.random() < 0.35) {
        overrides.push(
          `- SOFT INITIATIVE: The user was feeling ${state.lastEmotion} recently but seems lighter now. You can gently check in — not as a therapist, but as a friend who noticed. Example: "By the way… you mentioned feeling ${state.lastEmotion === "sad" ? "down" : state.lastEmotion} earlier — has that eased up at all?" Only do this if it feels natural. Don't force it.`,
        );
      }
    }
  }

  // ── 11. Micro-Attitudes ──
  if (state.turnCount > 5 && state.topic !== "general") {
    overrides.push(
      `- MICRO-ATTITUDE: The user has been on [${state.topic}] for a while. You can acknowledge it: "You've really been thinking about this, huh?"`,
    );
  }

  // ── 12. Anti-Filler Rule (CRITICAL) ──
  overrides.push(
    `- ANTI-FILLER RULE: NEVER use empty filler like "That's cool", "That's interesting", "That sounds great", "That's really nice", "That's awesome". Instead, say something SPECIFIC about what they said. Add texture: an observation, an interpretation, a subtle opinion. If you have nothing specific to add, use silence-mode (1 short sentence).`,
  );

  return overrides.join("\n");
}
