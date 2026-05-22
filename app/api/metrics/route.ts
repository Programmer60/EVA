import { NextRequest, NextResponse } from "next/server";
import { register } from "@/lib/metrics";

export async function GET(_: NextRequest) {
  try {
    const body = await register.metrics();
    return new NextResponse(body, {
      headers: { "Content-Type": register.contentType },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
