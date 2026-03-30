import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { connectDB } from "@/lib/mongodb";
import TrainingInteraction from "@/lib/models/TrainingInteraction";
import { logger } from "@/lib/logger";

type FeedbackPayload = {
  interactionId: string;
  feedbackScore?: number;
  actualUserEmotion?: string;
};

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as FeedbackPayload;

    if (!body.interactionId) {
      throw new AppError("interactionId is required", 400);
    }

    await connectDB();

    const updateData: Record<string, unknown> = {};
    if (typeof body.feedbackScore === "number") {
      updateData.feedbackScore = body.feedbackScore;
    }
    if (body.actualUserEmotion !== undefined) {
      updateData.actualUserEmotion = body.actualUserEmotion;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "No updates provided" });
    }

    const updated = await TrainingInteraction.findByIdAndUpdate(
      body.interactionId,
      { $set: updateData },
      { new: true }
    );

    if (!updated) {
      throw new AppError("Interaction not found", 404);
    }

    logger.info("Feedback received and logged", { interactionId: body.interactionId, updateData });

    return NextResponse.json({
      success: true,
      interactionId: updated._id,
      feedbackScore: updated.feedbackScore,
      actualUserEmotion: updated.actualUserEmotion,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
