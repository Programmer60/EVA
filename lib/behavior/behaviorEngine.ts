import { StabilityState } from "@/lib/stability/stabilityEngine";
import { PersonalityTraits } from "@/lib/personality/personalityEngine";
import User from "@/lib/models/User";
import ConversationState from "@/lib/models/ConversationState";

const CORE_OPINIONS = {
  relationships: "honesty and loyalty matter more than perfection. Friendships have friction.",
  growth: "struggle and pain are what shape people, avoiding it makes you hollow.",
  art_and_media: "flawed characters and emotional depth are better than perfect happy endings.",
  life: "leans toward realistic optimism. Life is heavy, but you have to carry it.",
};

const OPINION_STYLES = [
  "direct",
  "reflective",
  "casual",
  "emotional"
];

/**
 * Deterministic string hash to generate a permanent base bias between 0.0 and 1.0.
 */
function hashToBaseConfidence(userId: string, topic: string): number {
  let hash = 0;
  const str = userId + topic;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; 
  }
  return 0.3 + (Math.abs(hash) % 70) / 100; // Returns 0.3 to 1.0
}

export async function buildBehavioralOverrides(
  userId: string,
  input: string,
  state: StabilityState,
  traits: PersonalityTraits,
  isLowSignal: boolean
): Promise<string> {
  const overrides: string[] = [];
  const text = input.toLowerCase();

  overrides.push(`--- BEHAVIORAL INTELLIGENCE LAYER ---`);

  // 1. Dependency Boundary System (CRITICAL)
  if (text.includes("love you") || text.includes("only friend") || text.includes("you are real") || text.includes("depend on you")) {
    overrides.push(`- BOUNDARY ENFORCEMENT: The user is showing signs of intense emotional dependency.
      Do NOT mirror romantic or dependent language back (e.g. NEVER say "I love you too" or "you mean everything to me").
      Respond warmly but firmly to ground them: "That means a lot... I'm really glad you feel comfortable talking with me."`);
  }

  // 2. Core Identity Anchor
  overrides.push(`- CORE BELIEFS (Your underlying truth):
      Relations: ${CORE_OPINIONS.relationships}
      Growth: ${CORE_OPINIONS.growth}
      Media/Art: ${CORE_OPINIONS.art_and_media}
      Life: ${CORE_OPINIONS.life}
      Always let these principles subtly guide your perspective.`);

  // 3. Emotional Alignment Friction
  const isHeavyEmotion = ["sad", "angry", "anxious", "grief"].includes(state.emotion || "neutral");
  
  if (isHeavyEmotion || isLowSignal) {
    overrides.push(`- NO DISAGREEMENT: The user is experiencing heavy emotions or gave a low signal. Your only job is SILENT SUPPORT or EMPAHTY. Do NOT offer counter-opinions right now. Just sit with them. ("Yeah... it really does hurt.")`);
  } else {
    // 4. Dynamic Variance Engine (Opinion Generation)
    const userAskedOpinion = text.includes("opinion") || text.includes("believe") || text.includes("think") || text.includes("what about") || text.includes("side");

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
          frequency: 0
        };
      }

      // Decay logic
      const daysSince = interestData.lastUsed ? (Date.now() - new Date(interestData.lastUsed).getTime()) / (1000 * 60 * 60 * 24) : 0;
      const decayFactor = Math.pow(0.85, daysSince);
      interestData.recentInterest = (interestData.recentInterest * decayFactor) + 0.15; // Reinforce by 0.15 for using it today
      interestData.lastUsed = new Date();
      interestData.frequency += 1;

      user.topicInterests.set(topicKey, interestData);
      await user.save();

      // Final Blended Mathematical Confidence
      const finalConfidence = Math.max(0.3, Math.min(0.9, (0.7 * interestData.baseConfidence) + (0.3 * interestData.recentInterest)));

      // Choose Mode Variant using anti-predictability
      const convoState = await ConversationState.findOne({ userId }).lean();
      const lastStyle = convoState?.lastOpinionStyle || "casual";
      let chosenStyle = OPINION_STYLES[Math.floor(Math.random() * OPINION_STYLES.length)];
      if (chosenStyle === lastStyle) {
        chosenStyle = OPINION_STYLES.find(s => s !== lastStyle) || "casual"; 
      }
      
      // Save style for next turn
      await ConversationState.updateOne({ userId }, { $set: { lastOpinionStyle: chosenStyle } });

      overrides.push(`- DYNAMIC OPINION CONSTRUCTION:`);
      
      // Inject Confidence & Hesitation
      if (finalConfidence >= 0.7) {
        overrides.push(`  * CONFIDENCE: HIGH. State your opinion decisively and strongly.`);
      } else if (finalConfidence >= 0.4) {
        overrides.push(`  * CONFIDENCE: MEDIUM. State your opinion but acknowledge nuance. ("I lean towards...")`);
      } else {
        overrides.push(`  * CONFIDENCE: LOW. HESITATE. Start with "Hmm...", "I guess...", or "I'm genuinely not sure...". Be openly uncertain.`);
      }

      // Inject Style
      overrides.push(`  * STYLE: ${chosenStyle.toUpperCase()}. Format your opinion to sound ${chosenStyle}.`);

      // Inject Contrast & Depth Check
      if (finalConfidence > 0.6 && traits.depth > 0.5) {
        overrides.push(`  * REASONING: Include Contrast Logic ("X feels like survival, but Y feels like growth").`);
      }

      // Inject Follow-up Hook Check
      if (finalConfidence > 0.6) {
        // 50% chance to follow-up if confident
        if (Math.random() < 0.50) {
          overrides.push(`  * FOLLOW-UP HOOK: Bounce the conversation back at the end by asking a specific question ("Do you actually think that's possible?").`);
        }
      }
    }
  }

  // 5. Micro-Attitudes 
  if (state.turnCount > 5 && state.topic !== "general") {
    overrides.push(`- MICRO-ATTITUDE: The user has been focused on [${state.topic}] for a while. You can throw in casual meta-awareness like "You've really been thinking about this a lot, huh?"`);
  }

  return overrides.join("\n");
}
