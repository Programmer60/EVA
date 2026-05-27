import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { connectDB } from "@/lib/mongodb";
import Memory from "@/lib/models/Memory";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { classifyMemoryTier } from "@/lib/memory/memoryHygiene";
import { buildUserProfile } from "@/lib/profile/profileBuilder";

type MemoryRecord = {
  _id?: unknown;
  key?: unknown;
  value?: unknown;
  importance?: unknown;
  source?: unknown;
  lastAccessed?: unknown;
  memoryMentionCount?: unknown;
  lastMentionedAt?: unknown;
  deletedAt?: unknown;
};


export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (env.nodeEnv === "production") {
      throw new AppError("Memory debug endpoint is disabled in production.", 403);
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const includeProfile = request.nextUrl.searchParams.get("includeProfile") === "true";
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
      : 25;

    await connectDB();

    const memories = (await Memory.find({ userId, deletedAt: null })
      .sort({ importance: -1, lastAccessed: -1 })
      .limit(limit)
      .lean()) as MemoryRecord[];
    const profileResult = includeProfile ? await buildUserProfile(userId) : { profile: null };

    return NextResponse.json({
      userId,
      count: memories.length,
      profile: profileResult.profile,
      memories: memories.map((item) => ({
        id: String(item._id ?? ""),
        key: String(item.key ?? ""),
        value: String(item.value ?? ""),
        importance: Number(item.importance ?? 1),
        source: String(item.source ?? "chat"),
        lastAccessed: item.lastAccessed ?? null,
        memoryMentionCount: Number(item.memoryMentionCount ?? 0),
        lastMentionedAt: item.lastMentionedAt ?? null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    if (env.nodeEnv === "production") {
      throw new AppError("Memory editing is disabled in production.", 403);
    }

    const body = (await request.json()) as {
      userId?: string;
      memoryId?: string;
      key?: string;
      value?: string;
      importance?: number;
      source?: string;
    };
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const memoryId = String(body.memoryId ?? "").trim();

    if (!userId) {
      throw new AppError("userId is required.", 400);
    }
    if (!memoryId) {
      throw new AppError("memoryId is required.", 400);
    }

    await connectDB();

    const update: Record<string, unknown> = {};
    if (typeof body.key === "string" && body.key.trim().length > 0) {
      update.key = body.key.trim();
    }
    if (typeof body.value === "string" && body.value.trim().length > 0) {
      update.value = body.value.trim();
    }
    if (typeof body.importance === "number" && Number.isFinite(body.importance)) {
      update.importance = Math.max(0, Math.min(1, body.importance));
    }
    if (typeof body.source === "string" && body.source.trim().length > 0) {
      update.source = body.source.trim();
    }
    if (typeof update.key === "string" && typeof update.value === "string") {
      update.memoryTier = classifyMemoryTier(update.key, update.value);
    }

    const updated = await Memory.findOneAndUpdate(
      { _id: memoryId, userId, deletedAt: null },
      {
        $set: {
          ...update,
          lastAccessed: new Date(),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    if (!updated) {
      throw new AppError("Memory not found.", 404);
    }

    return NextResponse.json({
      ok: true,
      memory: {
        id: String(updated._id ?? ""),
        key: String(updated.key ?? ""),
        value: String(updated.value ?? ""),
        importance: Number(updated.importance ?? 1),
        source: String(updated.source ?? "chat"),
        lastAccessed: updated.lastAccessed ?? null,
        memoryMentionCount: Number(updated.memoryMentionCount ?? 0),
        lastMentionedAt: updated.lastMentionedAt ?? null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    if (env.nodeEnv === "production") {
      throw new AppError("Memory deletion is disabled in production.", 403);
    }

    const body = request.method === "DELETE" ? await request.json().catch(() => ({} as Record<string, unknown>)) : {};
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const memoryId = String((typeof body.memoryId === "string" ? body.memoryId : request.nextUrl.searchParams.get("memoryId")) ?? "").trim();

    if (!userId) {
      throw new AppError("userId is required.", 400);
    }
    if (!memoryId) {
      throw new AppError("memoryId is required.", 400);
    }

    await connectDB();

    const deleted = await Memory.findOneAndUpdate(
      { _id: memoryId, userId, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();

    if (!deleted) {
      throw new AppError("Memory not found.", 404);
    }

    return NextResponse.json({ ok: true, memoryId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
