import { NextResponse } from "next/server";

import { getAiAvailabilitySummary } from "@/lib/ai-settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const availability = await getAiAvailabilitySummary({ force });
    return NextResponse.json(availability);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to check AI Writing Assistant availability.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
