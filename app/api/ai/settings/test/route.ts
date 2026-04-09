import { NextResponse } from "next/server";

import { testAiCredentialInput } from "@/lib/ai-settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      apiKey?: string;
    };
    const settings = await testAiCredentialInput(payload.apiKey);
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to validate the saved OpenAI API key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
