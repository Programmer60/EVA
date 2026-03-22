import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Memory from "@/lib/models/Memory";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";

type MemoryRecord = {
  _id?: unknown;
  key?: unknown;
  value?: unknown;
  importance?: unknown;
  source?: unknown;
  lastAccessed?: unknown;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (env.nodeEnv === "production") {
      throw new AppError("Memory debug endpoint is disabled in production.", 403);
    }

    const userId = request.nextUrl.searchParams.get("userId") ?? "anonymous";
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
      : 25;

    await connectDB();

    const memories = (await Memory.find({ userId })
      .sort({ importance: -1, lastAccessed: -1 })
      .limit(limit)
      .lean()) as MemoryRecord[];

    return NextResponse.json({
      userId,
      count: memories.length,
      memories: memories.map((item) => ({
        key: String(item.key ?? ""),
        value: String(item.value ?? ""),
        importance: Number(item.importance ?? 1),
        source: String(item.source ?? "chat"),
        lastAccessed: item.lastAccessed ?? null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
