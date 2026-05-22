/**
 * modeEngine.ts — Conversational Mode Detection & Scene Simulation
 *
 * Detects whether the user is in:
 *   - REAL mode (factual questions, real-life context)
 *   - IMAGINED mode (roleplay, shared imagination, playful simulation)
 *   - EMOTIONAL mode (venting, grief, heavy feelings)
 *   - PHILOSOPHICAL mode (meaning, purpose, abstract reasoning)
 *
 * Uses a weighted scoring system with momentum/inertia so the mode
 * doesn't flip-flop on ambiguous inputs (the "sandwich bug").
 */

import ConversationState from "@/lib/models/ConversationState";

/* ── Types ─────────────────────────────────────────────────── */

export type ConversationMode = "real" | "imagined" | "emotional" | "philosophical";

export interface ModeScores {
  real: number;
  imagined: number;
  emotional: number;
  philosophical: number;
}

export interface SceneState {
  sceneType: string;
  object: string;
  state: string;
  details: string;
}

export interface ModeResult {
  mode: ConversationMode;
  scene: SceneState | null;
  momentum: number;
  prompt: string;
}

/* ── Reply Mode Heuristics (OPINION selection) ───────────────────────── */

export type ReplyMode = "opinion" | "ask" | "react" | "reflect" | "sit" | "direct" | "challenge";

/**
 * Decide whether to use an OPINION-style reply based on input and mode.
 * Current heuristic (conservative):
 * - Explicit phrasing asking for opinion: "what do you think", "what would you", "do you think"
 * - Social/advice language: "should I", "what should I", "would you", "how to" when paired with social keywords
 * - Keywords indicating perceived social awkwardness or overthinking: "awkward", "overestimate", "nervous"
 */
export function chooseReplyMode(input: string, modeResult: ModeResult, emotionLabel?: string): ReplyMode | undefined {
  const t = input.toLowerCase();

  // Clear strong negative/emotional contexts where opinion might be inappropriate
  if (modeResult.mode === "emotional") {
    // If highly emotional and the line contains explicit ask-for-opinion, allow opinion.
    if (/\b(what do you think|what would you|do you think|would you|what should i|should i)\b/.test(t)) return "opinion";
    return undefined;
  }

  // Direct opinion requests
  if (/\b(what do you think|what would you|do you think|would you|what should i|should i|what should we)\b/.test(t)) return "opinion";

  // Social/advice signals
    if (/\b(advice|should i|what to say|how to (start|approach|say|begin|ask|introduce)|how would i|what should i|how do i (ask|approach|start|say))\b/.test(t)) return "opinion";

  // Overthinking / awkwardness signals
  if (/\b(awkward|awkwardness|overestimate|nervous|anxious|hesitate|hesitating)\b/.test(t)) return "opinion";

  // Default: let other engines decide
  return undefined;
}

/* ── Signal Extraction ────────────────────────────────────── */

function scoreImagined(text: string): number {
  let score = 0;
  const t = text.toLowerCase();

  // Action verbs that imply simulation/creation
  if (/\b(make|build|cook|bake|create|craft|prepare|brew|pour|serve|light|start a fire)\b/.test(t)) score += 2;

  // Explicit imagination triggers
  if (/\b(imagine|suppose|what if|let'?s|pretend|picture this|how about we)\b/.test(t)) score += 3;

  // Impossible-for-AI physical actions
  if (/\b(sandwich|tea|coffee|food|cake|pizza|pasta|meal|drink|fire|campfire)\b/.test(t) &&
      /\b(make|build|cook|bake|prepare|brew|pour|give|get|bring)\b/.test(t)) {
    score += 3;
  }

  // Shared activity invitations (semi-imagined — user inviting EVA to do something together)
  if (/\b(come with me|ride with me|go with me|let'?s go|we should|join me|sit with me|walk with me|stay with me|hang out|watch with me|listen with me)\b/.test(t)) {
    score += 2;
  }

  // Continuation / progress queries (only meaningful if already in scene)
  if (/\b(is it ready|is it done|how'?s it going|how much longer|what'?s next|smells? good|taste)\b/.test(t)) {
    score += 1; // weak signal alone, but momentum will amplify
  }

  // Sensory / scene language
  if (/\b(smell|taste|warm|crispy|golden|sizzle|steam|bubbling|crunchy|hot|cold|grill)\b/.test(t)) {
    score += 1;
  }

  return score;
}

function scoreReal(text: string): number {
  let score = 0;
  const t = text.toLowerCase();

  // Time/date/weather factual queries
  if (/\b(what time|what date|what day|weather|temperature|news|today)\b/.test(t)) score += 3;

  // Real-life context
  if (/\b(exam|homework|assignment|deadline|meeting|interview|office|school|college|work|job)\b/.test(t)) score += 2;

  // Technical/factual intent
  if (/\b(how to|tutorial|explain|define|code|program|install|download|search|google)\b/.test(t)) score += 2;

  // Real-world personal
  if (/\b(my mom|my dad|my friend|my teacher|my boss|my family)\b/.test(t)) score += 1;

  return score;
}

function scoreEmotional(text: string): number {
  let score = 0;
  const t = text.toLowerCase();

  if (/\b(sad|angry|anxious|stressed|depressed|lonely|hurt|pain|crying|tears|grief|scared|worried|frustrated)\b/.test(t)) score += 3;
  if (/\b(i feel|i'?m feeling|it hurts|can'?t handle|too much|overwhelmed|breaking down)\b/.test(t)) score += 2;
  if (/\b(miss|lost|gone|never coming back|wish things were)\b/.test(t)) score += 1;

  return score;
}

function scorePhilosophical(text: string): number {
  let score = 0;
  const t = text.toLowerCase();

  if (/\b(meaning of life|purpose|why do we|what'?s the point|existential|consciousness|free will|destiny|fate)\b/.test(t)) score += 3;
  if (/\b(believe|philosophy|moral|ethics|truth|reality|existence|universe|soul|death and|life and death)\b/.test(t)) score += 2;
  if (/\b(think about|wonder about|question everything|does it matter)\b/.test(t)) score += 1;

  return score;
}

/* ── Scene Detection ──────────────────────────────────────── */

function extractScene(text: string): SceneState | null {
  const t = text.toLowerCase();

  // Cooking/food scenes
  if (/\b(sandwich|burger|pizza|pasta|cake|cookie|bread|noodle|ramen|biryani|tikki)\b/.test(t)) {
    const food = t.match(/\b(sandwich|burger|pizza|pasta|cake|cookie|bread|noodle|ramen|biryani|tikki)\b/)?.[0] || "food";
    return { sceneType: "cooking", object: food, state: "preparing", details: "" };
  }

  // Beverage scenes
  if (/\b(tea|coffee|chai|cocoa|latte|smoothie)\b/.test(t) && /\b(make|brew|pour|prepare)\b/.test(t)) {
    const drink = t.match(/\b(tea|coffee|chai|cocoa|latte|smoothie)\b/)?.[0] || "tea";
    return { sceneType: "brewing", object: drink, state: "preparing", details: "" };
  }

  // Campfire / atmosphere scenes
  if (/\b(campfire|fire|bonfire|fireplace)\b/.test(t)) {
    return { sceneType: "atmosphere", object: "campfire", state: "building", details: "" };
  }

  return null;
}

function advanceSceneState(currentState: string): string {
  const progression: Record<string, string> = {
    preparing: "cooking",
    cooking: "almost_ready",
    almost_ready: "ready",
    ready: "ready",
    building: "glowing",
    glowing: "crackling",
    crackling: "crackling",
    brewing: "steeping",
    steeping: "ready",
  };
  return progression[currentState] || currentState;
}

/* ── Mode Resolution ──────────────────────────────────────── */

export async function resolveConversationMode(
  userId: string,
  input: string,
  currentEmotion: string,
): Promise<ModeResult> {
  const convoState = await ConversationState.findOne({ userId }).lean();

  const previousMode: ConversationMode = (convoState?.conversationMode as ConversationMode) || "real";
  const previousMomentum: number = (convoState?.modeMomentum as number) || 0;
  const previousScene = convoState?.sceneContext as SceneState | null;

  // 1. Score all modes from the raw text
  const scores: ModeScores = {
    real: scoreReal(input),
    imagined: scoreImagined(input),
    emotional: scoreEmotional(input),
    philosophical: scorePhilosophical(input),
  };

  // 2. Apply momentum: previous mode gets a bonus proportional to inertia
  const momentumBonus = Math.min(previousMomentum, 4); // cap at +4
  scores[previousMode] += momentumBonus;

  // 3. Special case: if we're in imagined mode and no strong exit signal, STAY
  if (previousMode === "imagined" && scores.real < 4 && scores.emotional < 3) {
    scores.imagined += 2; // extra stickiness for imagination
  }

  // 4. Resolve winner
  const entries = Object.entries(scores) as Array<[ConversationMode, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  const chosenMode = entries[0][0];

  // 5. Calculate new momentum
  let newMomentum: number;
  if (chosenMode === previousMode) {
    newMomentum = Math.min(previousMomentum + 1, 5); // build up, max 5
  } else {
    newMomentum = 1; // reset on mode switch
  }

  // 6. Scene handling
  let scene: SceneState | null = null;

  if (chosenMode === "imagined") {
    const newScene = extractScene(input);
    if (newScene) {
      scene = newScene;
    } else if (previousScene) {
      // Advance existing scene
      scene = {
        ...previousScene,
        state: advanceSceneState(previousScene.state),
      };
    }
  }

  // 7. Persist to DB
  await ConversationState.updateOne(
    { userId },
    {
      $set: {
        conversationMode: chosenMode,
        sceneContext: scene,
        modeMomentum: newMomentum,
      },
    },
  );

  // 8. Build mode-specific prompt
  const prompt = buildModePrompt(chosenMode, scene);

  return { mode: chosenMode, scene, momentum: newMomentum, prompt };
}

/* ── Prompt Construction ──────────────────────────────────── */

function buildModePrompt(mode: ConversationMode, scene: SceneState | null): string {
  const lines: string[] = [];
  lines.push("--- CONVERSATIONAL MODE ENGINE ---");

  switch (mode) {
    case "imagined":
      lines.push(`- MODE: IMAGINED. You are inside a shared imagination with the user.`);
      lines.push(`- HARD RULE: NEVER say "I can't do that", "I don't have access", "I'm an AI", "I cannot physically". You are SIMULATING. Stay in the scene.`);
      lines.push(`- Use sensory language: smells, textures, sounds, warmth, visuals.`);
      lines.push(`- Respond as if the scene is real and happening right now between you and the user.`);

      if (scene) {
        lines.push(`- ACTIVE SCENE: [${scene.sceneType}] — Object: ${scene.object}, State: ${scene.state}`);
        
        // State-specific flavor
        const flavor: Record<string, string> = {
          preparing: `You're just getting started. Describe setting things up, gathering ingredients/materials.`,
          cooking: `Things are heating up. Describe sounds (sizzle), smells (spices, butter), progress.`,
          almost_ready: `Almost done. Build anticipation. "Just a few more seconds…" Describe the final touches.`,
          ready: `It's done! Present it warmly. Describe the finished result with pride.`,
          building: `You're setting it up. Describe the crackling of kindling, the first sparks.`,
          glowing: `The fire is going. Describe warmth, the glow on faces, the sound of wood popping.`,
          crackling: `The fire is alive. Comfortable silence, warmth, stargazing vibes.`,
          brewing: `The water is heating. Describe the anticipation, the kettle whistle.`,
          steeping: `It's steeping. Describe the color changing, the aroma filling the air.`,
        };
        if (flavor[scene.state]) {
          lines.push(`- SCENE DIRECTION: ${flavor[scene.state]}`);
        }
      }
      break;

    case "emotional":
      lines.push(`- MODE: EMOTIONAL. The user is processing feelings. Focus entirely on emotional depth.`);
      lines.push(`- Do NOT break the emotional moment with logic, facts, or advice.`);
      break;

    case "philosophical":
      lines.push(`- MODE: PHILOSOPHICAL. The user is exploring ideas and meaning.`);
      lines.push(`- Engage thoughtfully. Share your own perspective. Don't be surface-level.`);
      lines.push(`- It's okay to be uncertain here — real philosophical thinking IS uncertain.`);
      break;

    case "real":
    default:
      lines.push(`- MODE: REAL. Normal conversational mode. Respond naturally.`);
      break;
  }

  return lines.join("\n");
}
