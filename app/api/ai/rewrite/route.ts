import { NextResponse } from "next/server";

import {
  type AiTransformType,
  AiRewriteRequestError,
  rewriteWithCurrentOwner
} from "@/lib/ai-rewrite";
import type {
  AiRewriteModeId,
  AiRewriteModifierId,
  AiRewriteOutputType
} from "@/lib/ai-rewrite-modes";
import type {
  AiPolishCultureCountryId,
  AiPolishCultureRecipientSeniority,
  AiPolishCultureRelationshipStage,
  AiPolishCultureRegionId,
  AiPolishModeId,
  AiPolishModifierId
} from "@/lib/ai-polish-modes";

export const runtime = "nodejs";

type RewritePayload = {
  selectedText?: string;
  fullDraftText?: string;
  type?: AiTransformType;
  mode?: AiRewriteModeId | AiPolishModeId;
  modifiers?: Array<AiRewriteModifierId | AiPolishModifierId>;
  region?: AiPolishCultureRegionId;
  countryId?: AiPolishCultureCountryId;
  seniority?: AiPolishCultureRecipientSeniority;
  relationshipStage?: AiPolishCultureRelationshipStage;
  outputType?: AiRewriteOutputType;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as RewritePayload;

    if (!payload.mode) {
      return NextResponse.json({ error: "Choose a rewrite mode." }, { status: 400 });
    }

    const result = await rewriteWithCurrentOwner({
      type: payload.type ?? "rewrite",
      selectedText: payload.selectedText,
      fullDraftText: payload.fullDraftText,
      mode: payload.mode,
      modifiers: payload.modifiers ?? [],
      region: payload.region,
      countryId: payload.countryId,
      seniority: payload.seniority,
      relationshipStage: payload.relationshipStage,
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
