import {
  type AiPolishCultureCountryId,
  type AiPolishCultureRecipientSeniority,
  type AiPolishCultureRelationshipStage,
  type AiPolishCultureRegionId,
  type AiPolishModeId,
  type AiPolishModifierId,
  AI_POLISH_CULTURE_REGIONS,
  areAiPolishModifiersValid,
  getAiPolishModeDefinition
} from "@/lib/ai-polish-modes";
import { buildAiPolishMessages } from "@/lib/ai-polish-prompt";
import {
  type AiRewriteModeId,
  type AiRewriteModifierId,
  type AiRewriteOutputType,
  AI_REWRITE_MAX_INPUT_CHARS,
  AI_REWRITE_MAX_MODIFIERS,
  AI_REWRITE_REPEAT_COOLDOWN_MS,
  areAiRewriteModifiersValid,
  getAiRewriteModeDefinition
} from "@/lib/ai-rewrite-modes";
import { buildAiRewriteMessages } from "@/lib/ai-rewrite-prompt";
import { getCurrentOwnerOpenAiCredential } from "@/lib/ai-settings";

const OPENAI_REWRITE_MODEL = "gpt-4.1-mini";
const ownerInFlightRewriteMap = new Map<string, string>();
const ownerRecentRewriteMap = new Map<string, { signature: string; expiresAt: number }>();

export type AiRewriteRequest = {
  selectedText?: string;
  fullDraftText?: string;
  type?: AiTransformType;
  mode: AiTransformModeId;
  modifiers?: AiTransformModifierId[];
  region?: AiPolishCultureRegionId;
  countryId?: AiPolishCultureCountryId;
  seniority?: AiPolishCultureRecipientSeniority;
  relationshipStage?: AiPolishCultureRelationshipStage;
  outputType: AiRewriteOutputType;
};

export type AiTransformType = "rewrite" | "polish";
export type AiTransformModeId = AiRewriteModeId | AiPolishModeId;
export type AiTransformModifierId = AiRewriteModifierId | AiPolishModifierId;

export type AiRewriteOption = {
  id: string;
  label: string;
  text: string;
  culturalNotes?: string[];
};

export type AiRewriteResponse = {
  type: AiTransformType;
  mode: AiTransformModeId;
  outputType: AiRewriteOutputType;
  target: "selection" | "draft";
  sourceText: string;
  modifiers: AiTransformModifierId[];
  options: AiRewriteOption[];
};

export class AiRewriteRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "AiRewriteRequestError";
    this.status = options?.status ?? 400;
    this.code = options?.code ?? "rewrite_request_error";
  }
}

function normalizeSourceText(input: AiRewriteRequest) {
  const selectedText = input.selectedText?.trim() ?? "";
  const fullDraftText = input.fullDraftText?.trim() ?? "";

  if (selectedText) {
    return {
      target: "selection" as const,
      text: selectedText
    };
  }

  if (fullDraftText) {
    return {
      target: "draft" as const,
      text: fullDraftText
    };
  }

  throw new AiRewriteRequestError("Add some draft text or select text to rewrite.", {
    status: 400,
    code: "missing_text"
  });
}

function validateRewriteRequest(input: AiRewriteRequest) {
  const type = input.type ?? "rewrite";
  const modifiers = Array.from(new Set(input.modifiers ?? []));
  if (modifiers.length > AI_REWRITE_MAX_MODIFIERS) {
    throw new AiRewriteRequestError("Choose up to 3 modifier chips.", {
      status: 400,
      code: "too_many_modifiers"
    });
  }

  if (input.outputType !== "rewrite" && input.outputType !== "two_options") {
    throw new AiRewriteRequestError("Unknown rewrite output type.", {
      status: 400,
      code: "invalid_output_type"
    });
  }

  const source = normalizeSourceText(input);
  if (source.text.length > AI_REWRITE_MAX_INPUT_CHARS) {
    throw new AiRewriteRequestError(
      "That draft section is too long for one rewrite. Shorten it and try again.",
      {
        status: 400,
        code: "input_too_large"
      }
    );
  }

  if (type === "polish") {
    const mode = getAiPolishModeDefinition(input.mode);
    if (!mode) {
      throw new AiRewriteRequestError("Unknown polish mode.", {
        status: 400,
        code: "invalid_mode"
      });
    }

    if (!areAiPolishModifiersValid(mode.id, modifiers)) {
      throw new AiRewriteRequestError(
        "One or more modifier chips do not match the selected polish mode.",
        {
          status: 400,
          code: "invalid_modifiers"
        }
      );
    }

    return {
      type,
      mode,
      modifiers: modifiers as AiPolishModifierId[],
      region:
        input.region &&
        AI_POLISH_CULTURE_REGIONS.some((item) => item.id === input.region)
          ? input.region
          : "global",
      countryId: input.countryId,
      seniority: input.seniority,
      relationshipStage: input.relationshipStage,
      outputType: input.outputType,
      source
    };
  }

  const mode = getAiRewriteModeDefinition(input.mode);
  if (!mode) {
    throw new AiRewriteRequestError("Unknown rewrite mode.", {
      status: 400,
      code: "invalid_mode"
    });
  }

  if (!areAiRewriteModifiersValid(mode.id, modifiers)) {
    throw new AiRewriteRequestError(
      "One or more modifier chips do not match the selected mode.",
      {
        status: 400,
        code: "invalid_modifiers"
      }
    );
  }

  return {
    type,
    mode,
    modifiers: modifiers as AiRewriteModifierId[],
    outputType: input.outputType,
    source
  };
}

function buildRewriteRequestSignature(input: {
  type: AiTransformType;
  mode: AiTransformModeId;
  modifiers: AiTransformModifierId[];
  region?: AiPolishCultureRegionId;
  outputType: AiRewriteOutputType;
  source: {
    target: "selection" | "draft";
    text: string;
  };
}) {
  return JSON.stringify({
    type: input.type,
    mode: input.mode,
    modifiers: input.modifiers,
    region: input.region ?? null,
    outputType: input.outputType,
    target: input.source.target,
    text: input.source.text
  });
}

function parseRewriteCompletion(content: string, expectedCount: number) {
  try {
    const parsed = JSON.parse(content) as {
      options?: Array<{
        label?: string;
        text?: string;
      }>;
    };

    const options = (parsed.options ?? [])
      .map((option, index) => ({
        id: `option_${index + 1}`,
        label: option.label?.trim() || `Option ${index + 1}`,
        text: option.text?.trim() || "",
        culturalNotes: Array.isArray((option as { culturalNotes?: unknown[] }).culturalNotes)
          ? ((option as { culturalNotes?: unknown[] }).culturalNotes as string[]).filter(
              (n) => typeof n === "string" && n.trim().length > 0
            )
          : undefined
      }))
      .filter((option) => option.text.length > 0);

    if (options.length > 0) {
      return options.slice(0, expectedCount);
    }
  } catch {
    // Fall back to a single raw-text option if the model doesn't return JSON.
  }

  const fallbackText = content.trim();
  if (!fallbackText) {
    throw new Error("OpenAI returned an empty rewrite.");
  }

  return [
    {
      id: "option_1",
      label: "Rewrite",
      text: fallbackText
    }
  ];
}

export async function rewriteWithCurrentOwner(input: AiRewriteRequest): Promise<AiRewriteResponse> {
  const validated = validateRewriteRequest(input);
  const credential = await getCurrentOwnerOpenAiCredential();
  const expectedCount = validated.outputType === "two_options" ? 2 : 1;
  const ownerScope = credential.owner.scope;
  const requestSignature = buildRewriteRequestSignature({
    type: validated.type,
    mode: validated.mode.id,
    modifiers: validated.modifiers,
    region: validated.type === "polish" ? validated.region : undefined,
    outputType: validated.outputType,
    source: validated.source
  });
  const activeSignature = ownerInFlightRewriteMap.get(ownerScope);

  if (activeSignature) {
    throw new AiRewriteRequestError(
      "A rewrite is already in progress. Give it a moment before trying again.",
      {
        status: 429,
        code: "rewrite_in_flight"
      }
    );
  }

  const recentRequest = ownerRecentRewriteMap.get(ownerScope);
  if (
    recentRequest &&
    recentRequest.signature === requestSignature &&
    recentRequest.expiresAt > Date.now()
  ) {
    throw new AiRewriteRequestError(
      "That exact rewrite was just sent. Give it a moment before trying it again.",
      {
        status: 429,
        code: "rewrite_cooldown"
      }
    );
  }

  ownerInFlightRewriteMap.set(ownerScope, requestSignature);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_REWRITE_MODEL,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages:
          validated.type === "polish"
            ? buildAiPolishMessages({
                ...validated,
                countryId: validated.countryId,
                seniority: validated.seniority,
                relationshipStage: validated.relationshipStage
              })
            : buildAiRewriteMessages(validated)
      }),
      cache: "no-store"
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          choices?: Array<{
            message?: {
              content?: string | null;
            };
          }>;
          error?: {
            message?: string;
          };
        }
      | null;

    if (!response.ok) {
      throw new AiRewriteRequestError(
        payload?.error?.message?.trim() ||
          "OpenAI couldn't complete that rewrite request.",
        {
          status: response.status >= 400 && response.status < 600 ? response.status : 502,
          code: "provider_error"
        }
      );
    }

    const content = payload?.choices?.[0]?.message?.content?.trim() ?? "";
    const options = parseRewriteCompletion(content, expectedCount);

    return {
      type: validated.type,
      mode: validated.mode.id,
      outputType: validated.outputType,
      target: validated.source.target,
      sourceText: validated.source.text,
      modifiers: validated.modifiers,
      options
    };
  } finally {
    ownerInFlightRewriteMap.delete(ownerScope);
    ownerRecentRewriteMap.set(ownerScope, {
      signature: requestSignature,
      expiresAt: Date.now() + AI_REWRITE_REPEAT_COOLDOWN_MS
    });
  }
}
