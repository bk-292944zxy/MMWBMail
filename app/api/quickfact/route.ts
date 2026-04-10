import { NextResponse } from "next/server";

import type { QuickFactRequest, QuickFactResponse } from "@/lib/quickfact";
import { fetchQuickFactsFromTavily } from "@/lib/tavily-quickfact";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Partial<QuickFactRequest>;
    const query = payload.query?.trim() ?? "";

    if (!query) {
      return NextResponse.json({ error: "What fact do you need?", results: [] }, { status: 400 });
    }

    const response = await fetchQuickFactsFromTavily(query);
    return NextResponse.json(response satisfies QuickFactResponse);
  } catch {
    return NextResponse.json({
      results: [],
      fallback: {
        reason: "backend_error",
        message: "No solid quick fact surfaced fast enough.",
        actionLabel: "Search more broadly"
      }
    } satisfies QuickFactResponse);
  }
}
