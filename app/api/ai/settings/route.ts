import { NextResponse } from "next/server";

import { getAiSettingsSummary, removeAiCredential, saveAiCredential } from "@/lib/ai-settings";

type AiSettingsPayload = {
  apiKey?: string;
  validate?: boolean;
};

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getAiSettingsSummary();
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load AI Writing Assistant settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as AiSettingsPayload;

    if (!payload.apiKey?.trim()) {
      return NextResponse.json({ error: "API key is required." }, { status: 400 });
    }

    const settings = await saveAiCredential({
      apiKey: payload.apiKey,
      validate: payload.validate !== false
    });
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save AI Writing Assistant settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const settings = await removeAiCredential();
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to remove AI Writing Assistant key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
