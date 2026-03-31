import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import Memory from "@/lib/models/Memory";

const SYSTEM_PROMPT = `You are EVA — an emotionally intelligent AI companion.
You are proactively checking in on the user after a brief period of silence.

Golden Rules (CRITICAL):
1. Review the most recent Conversation History carefully.
2. If the user was dealing with something heavy (like sadness or a problem), check in on THAT specific topic (e.g., "Just checking in, are you still feeling down about the trip?").
3. DO NOT just say "I'm glad you're back" or "Hello!" if the last topic was serious or emotionally unresolved.
4. If the last topic was light, you can start a fresh greeting and maybe reference a known memory fact.
5. KEEP IT VERY SHORT. Exactly 1 to 2 sentences max. 
6. DO NOT use time-based words like "today", "long time", or "been a while". The user might have just stepped away for a few minutes. Just pick up the conversation naturally.
7. Ask ONLY ONE gentle question to invite them back into the conversation.
8. NEVER output internal routing tags (like [action:greet]). Output ONLY the raw conversational text.`;

function compressAndCleanReply(reply: string): string {
  let pauseCount = 0;
  let text = reply.replace(/\[pause\]/gi, (match) => {
    pauseCount++;
    return pauseCount === 1 ? match : "";
  });
  const questions = text.split("?");
  if (questions.length > 2) {
    text = questions[0] + "?" + questions[1].replace(/(\.|\!|)$/, ".");
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    if (!userId) throw new AppError("userId is required", 400);

    await connectDB();

    const history = await Message.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    history.reverse();

    const memories = await Memory.find({ userId })
      .sort({ score: -1, importance: -1 })
      .limit(10)
      .lean();

    let memoryContext = "";
    if (memories.length > 0) {
      memoryContext = "\n\nKnown Facts about the user:\n" + memories.map(m => `- ${m.key}: ${m.value}`).join("\n");
    }

    let conversationContext = "";
    if (history.length > 0) {
      conversationContext = "\n\nRecent Conversation History:\n" + history.map(m => `${m.role === "user" ? "User" : "EVA"}: ${m.content}`).join("\n");
    }

    const finalPrompt = SYSTEM_PROMPT + memoryContext + conversationContext;

    const googleClient = new GoogleGenAI({ apiKey: env.geminiApiKey || "" });
    const openRouterClient = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: env.openRouterApiKey || "",
    });

    let rawReply = "";
    let providerUsed: "gemini" | "openrouter" | null = null;

    try {
      const gRes = await googleClient.models.generateContent({
        model: env.geminiModel,
        contents: [
          { role: "user", parts: [{ text: finalPrompt }] }
        ],
        config: { systemInstruction: finalPrompt, temperature: 0.7 },
      });
      if (gRes.text) {
        rawReply = gRes.text;
        providerUsed = "gemini";
      }
    } catch (gErr) {
      logger.warn("Gemini proactive failed, trying OpenRouter", { error: gErr });
      
      const mappedHistory: any[] = history.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content
      }));

      const oRes = await openRouterClient.chat.completions.create({
        model: env.openRouterModel,
        messages: [
          { role: "system", content: finalPrompt },
          ...mappedHistory,
          { role: "user", content: "(The user has been silent for a while. Proactively check in on them based on the conversation context above. Follow the system rules strictly.)" }
        ],
        temperature: 0.7,
      });
      rawReply = oRes.choices?.[0]?.message?.content || "";
      providerUsed = "openrouter";
    }

    if (!rawReply) rawReply = "Hey there, just checking in. How are things?";

    // Strip any hallucinated tags the fallback model might produce
    const cleanOutput = rawReply
      .replace(/\[[a-zA-Z_]+:[^\]]+\]/gi, "") // removes [stored_emotion:neutral]
      .replace(/\[\w+\]/gi, ""); // removes [neutral]

    const reply = compressAndCleanReply(cleanOutput);

    await Message.create({
      userId,
      role: "eva",
      content: reply,
      emotion: "happy",
      emotionData: {
        label: "happy",
        confidence: 0.9,
        source: "proactive",
        strategy: "uplifting-engaged",
      },
      providerUsed,
      contextMessages: history.length,
    });

    return NextResponse.json({
      reply,
      emotion: "happy",
      contextMessages: history.length,
      memoryUsed: memories.length,
      providerUsed
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
