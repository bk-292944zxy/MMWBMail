import { NextResponse } from "next/server";

import {
  getTavilySettingsSummary,
  removeTavilyCredential,
  saveTavilyCredential
} from "@/lib/tavily-settings";

type TavilySettingsPayload = {
  apiKey?: string;
};

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getTavilySettingsSummary();
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load QuickFact settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as TavilySettingsPayload;

    if (!payload.apiKey?.trim()) {
      return NextResponse.json({ error: "API key is required." }, { status: 400 });
    }

    const settings = await saveTavilyCredential({
      apiKey: payload.apiKey
    });
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save QuickFact settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const settings = await removeTavilyCredential();
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to remove QuickFact key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
