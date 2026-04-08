import ConversationState from "@/lib/models/ConversationState";
import { extractTopic } from "./topicExtractor";

export type StabilityState = {
  stage: "START" | "BUILD" | "DEEP" | "COOLDOWN";
  topic: string;
  emotion: string;
  lastEmotion: string;
  lastMode: "reaction" | "reflection" | "question" | "sit";
  turnCount: number;
};

/**
 * Loads or initializes the conversation state.
 * Advances the turn count and updates topics and emotion streams.
 */
export async function processConversationState(
  userId: string,
  input: string,
  currentEmotionLabel: string,
  isLowSignal: boolean
): Promise<StabilityState> {
  let state = await ConversationState.findOne({ userId }).lean();

  if (!state) {
    state = await ConversationState.create({
      userId,
      stage: "START",
      topic: "general",
      emotion: currentEmotionLabel,
      lastEmotion: "neutral",
      lastMode: "reaction",
      turnCount: 0,
    });
  }

  const turnCount = (state.turnCount || 0) + 1;
  const lastEmotion = state.emotion || "neutral";
  const emotion = currentEmotionLabel;

  // Determine stage based on heuristics
  let stage = state.stage;
  const isHeavyEmotion = ["sad", "angry", "anxious", "nostalgic"].includes(emotion);
  
  if (isHeavyEmotion && turnCount > 1) {
    stage = "DEEP";
  } else if (turnCount < 3) {
    stage = "START";
  } else if (turnCount >= 3 && !isHeavyEmotion) {
    stage = "BUILD";
  } else if (turnCount > 15 && !isHeavyEmotion) {
    stage = "COOLDOWN";
  }

  // Extract topic (hybrid) only if it's high signal
  const topic = isLowSignal ? state.topic : await extractTopic(input, stage === "DEEP");

  // Save updated state
  await ConversationState.updateOne(
    { userId },
    {
      $set: {
        stage,
        topic,
        emotion,
        lastEmotion,
        turnCount,
        lastUpdated: new Date(),
      },
    }
  );

  return {
    stage: stage as "START" | "BUILD" | "DEEP" | "COOLDOWN",
    topic,
    emotion,
    lastEmotion,
    lastMode: (state.lastMode || "reaction") as "reaction" | "reflection" | "question" | "sit",
    turnCount,
  };
}

/**
 * Builds the prompt constraints derived from the current conversational momentum.
 */
export function buildStabilityPrompt(state: StabilityState, isLowSignal: boolean): string {
  const constraints: string[] = [];

  constraints.push(`STABILITY ENGINE OVERRIDES:`);

  // 1. Topic Locking in DEEP phase
  if (state.stage === "DEEP") {
    constraints.push(`- TOPIC LOCK ENGAGED: The user is in a deeply emotional phase. Do NOT introduce new random topics. Focus heavily on: [${state.topic}]. Do NOT pivot to side-preferences.`);
  } else if (state.stage === "START") {
    constraints.push(`- CONVERSATION STAGE: Starting up. Keep the response light and simple. Do not go too deep immediately.`);
  }

  // 2. Mode Enforcement
  if (isLowSignal) {
    constraints.push(`- STRICT MODE ENFORCEMENT: The user gave a low-signal response. Mode MUST BE "SIT WITH IT". No questions, no deep reflections. Just support.`);
  } else if (state.lastMode === "question") {
    constraints.push(`- STRICT MODE ENFORCEMENT: You asked a question in your very last turn. You MUST NOT ask another question. Use REACT or REFLECT mode only.`);
  } else {
    // Basic variety enforcement
    constraints.push(`- MODE VARIETY: Choose your mode naturally (React, Reflect, Ask, Sit), but try to balance reactions over questions.`);
  }

  // 3. Emotional Continuity Guard
  if (["sad", "angry", "anxious"].includes(state.lastEmotion) && !["sad", "angry", "anxious"].includes(state.emotion)) {
    constraints.push(`- EMOTIONAL CONTINUITY: The user was just recently feeling ${state.lastEmotion}. Even if they sound neutral now, maintain a gentle, grounded tone. Don't immediately snap to overly hyper or happy.`);
  }

  return constraints.join("\n");
}

/**
 * Runs structural checks over the LLM output before it hits the presence layer.
 * Specifically aggressively drops duplicate questions if the stability engine forbade it.
 */
export function validateAndFixResponse(reply: string, state: StabilityState): string {
  let cleaned = reply;

  // Interrogation Fix: If we were forbidden from asking questions, forcefully strip sentences ending in '?'
  if (state.lastMode === "question" && cleaned.includes("?")) {
    const sentences = cleaned.match(/[^.!?]+[.!?]*/g) || [cleaned];
    const filtered = sentences.filter(s => !s.includes("?"));
    if (filtered.length > 0) {
      cleaned = filtered.join(" ").trim();
    } else {
      // If the entire thing was a single question and it was stripped, replace with a soft acknowledgment.
      cleaned = "Yeah... I hear you."; 
    }
  }

  return cleaned.trim();
}

/**
 * Updates the lastMode in the DB after generating a response.
 */
export async function updateStabilityLastMode(userId: string, reply: string) {
  let finalMode = "reaction";
  if (reply.includes("?")) {
    finalMode = "question";
  } else if (reply.length < 20) {
    finalMode = "sit";
  } else if (reply.includes("wonder") || reply.includes("feels like") || reply.includes("makes me think")) {
    finalMode = "reflection";
  }

  await ConversationState.updateOne({ userId }, { $set: { lastMode: finalMode } });
}
