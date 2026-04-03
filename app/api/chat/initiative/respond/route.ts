import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { connectDB } from "@/lib/mongodb";
import InitiativeLog from "@/lib/models/InitiativeLog";
import { logger } from "@/lib/logger";

/**
 * PATCH /api/chat/initiative/respond
 * Called when the user sends a message after a proactive initiative.
 * Marks the most recent non-silence initiative as "userResponded: true".
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    await connectDB();

    // Find the most recent non-silence initiative for this user
    const updated = await InitiativeLog.findOneAndUpdate(
      {
        userId,
        type: { $ne: "silence" },
        userResponded: false,
        ignored: false,
      },
      {
        $set: {
          userResponded: true,
          userRespondedAt: new Date(),
        },
      },
      { sort: { sentAt: -1 }, new: true },
    );

    if (updated) {
      logger.info("Initiative marked as responded", {
        userId,
        initiativeId: updated._id,
        type: updated.type,
      });
    }

    return NextResponse.json({ success: true, updated: !!updated });
  } catch (error) {
    return toErrorResponse(error);
  }
}
