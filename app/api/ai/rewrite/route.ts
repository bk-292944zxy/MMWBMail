import { NextResponse } from "next/server";

import { AiRewriteRequestError, rewriteWithCurrentOwner } from "@/lib/ai-rewrite";
import type {
  AiRewriteModeId,
  AiRewriteModifierId,
  AiRewriteOutputType
} from "@/lib/ai-rewrite-modes";

export const runtime = "nodejs";

type RewritePayload = {
  selectedText?: string;
  fullDraftText?: string;
  mode?: AiRewriteModeId;
  modifiers?: AiRewriteModifierId[];
  outputType?: AiRewriteOutputType;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as RewritePayload;

    if (!payload.mode) {
      return NextResponse.json({ error: "Choose a rewrite mode." }, { status: 400 });
    }

    const result = await rewriteWithCurrentOwner({
      selectedText: payload.selectedText,
      fullDraftText: payload.fullDraftText,
      mode: payload.mode,
      modifiers: payload.modifiers ?? [],
      outputType: payload.outputType ?? "rewrite"
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiRewriteRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : "Unable to rewrite the draft.";
    return NextResponse.json({ error: message, code: "rewrite_failed" }, { status: 500 });
  }
}
