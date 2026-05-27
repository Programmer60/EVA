import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import { toErrorResponse } from "@/lib/errors";
import { cacheGet, cacheSet } from "@/lib/redis";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "10");

    // ── Redis Cache Check ──
    const cacheKey = `historyApi:${userId}:${limit}`;
    const cached = await cacheGet<Array<{ role: string; content: string; timestamp: string }>>(cacheKey);
    if (cached) {
      logger.info("[Redis Hit] History API served from cache", { userId, limit });
      return NextResponse.json({ messages: cached });
    }

    await connectDB();

    const messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const formatted = messages.reverse().map((m: any) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }));

    // Cache for 2 minutes
    await cacheSet(cacheKey, formatted, 120);
    logger.info("[MongoDB Query] History API fetched & cached", { userId, limit, count: formatted.length });

    return NextResponse.json({ messages: formatted });
  } catch (error) {
    return toErrorResponse(error);
  }
}
