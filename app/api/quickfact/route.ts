import { NextResponse } from "next/server";

import type { QuickFactRequest, QuickFactResponse } from "@/lib/quickfact";
import { runQuickFactPipeline } from "@/lib/quickfact-pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<QuickFactRequest>;
    const query = payload.query?.trim() ?? "";
    const draftContext = typeof payload.draftContext === "string"
      ? payload.draftContext.trim().slice(0, 150)
      : undefined;

    if (!query) {
      return NextResponse.json({ error: "What fact do you need?", results: [] }, { status: 400 });
    }

    const response = await runQuickFactPipeline(query, draftContext);
    return NextResponse.json(response satisfies QuickFactResponse);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "No solid quick fact surfaced fast enough.";

    return NextResponse.json({
      results: [],
      fallback: {
        reason: "backend_error",
        message,
        actionLabel: "Search more broadly"
      }
    } satisfies QuickFactResponse);
  }
}
