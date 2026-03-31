import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Message from "@/lib/models/Message";
import { toErrorResponse } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId") ?? "anonymous";
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "10");

    await connectDB();

    const messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json({
      messages: messages.reverse().map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
