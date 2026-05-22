import { NextRequest, NextResponse } from "next/server";
import { getProviderSnapshot } from "@/lib/providerHealth";

export async function GET(_: NextRequest) {
  const snapshot = await getProviderSnapshot();
  return NextResponse.json({ providers: snapshot });
}
