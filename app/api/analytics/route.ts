import { NextRequest, NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getAnalyticsOverview } from "@/lib/analytics/analyticsService";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "8");
    const overview = await getAnalyticsOverview(userId, Number.isFinite(limit) ? limit : 8);

    return NextResponse.json(overview, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error instanceof AppError ? error : new AppError(String(error), 500));
  }
}
