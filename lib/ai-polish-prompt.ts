import type {
  AiPolishCultureCountryId,
  AiPolishCultureRecipientSeniority,
  AiPolishCultureRelationshipStage,
  AiPolishCultureRegionId,
  AiPolishModeDefinition,
  AiPolishModifierId
} from "@/lib/ai-polish-modes";
import { AI_POLISH_MODIFIERS } from "@/lib/ai-polish-modes";
import type { AiRewriteOutputType } from "@/lib/ai-rewrite-modes";

type AiPolishPromptInput = {
  mode: AiPolishModeDefinition;
  modifiers: AiPolishModifierId[];
  region?: AiPolishCultureRegionId;
  countryId?: AiPolishCultureCountryId;
  seniority?: AiPolishCultureRecipientSeniority;
  relationshipStage?: AiPolishCultureRelationshipStage;
  outputType: AiRewriteOutputType;
  source: {
    target: "selection" | "draft";
    text: string;
  };
};

type AiPolishChatMessage = {
  role: "system" | "user";
  content: string;
};

const BASE_PROMPT = `You are refining the presentation of a message.

DO NOT change intent, meaning, or outcome.
DO NOT add new information.

Only improve:
- tone
- clarity
- structure
- readability`;

function getModeInstructions(
  mode: AiPolishModeDefinition["id"],
  region: AiPolishCultureRegionId,
  countryId?: AiPolishCultureCountryId,
  seniority?: AiPolishCultureRecipientSeniority,
  relationshipStage?: AiPolishCultureRelationshipStage
) {
  switch (mode) {
    case "clean":
      return "Tighten clarity, flow, and structure. Remove redundancy, compress phrasing, and improve readability. Keep tone register exactly as-is — do not shift warmer, cooler, more formal, or more casual.";
    case "formal":
      return "Increase formality and courtesy. Use complete phrasing, structured sentences, and traditional professional tone. Reduce contractions. Do not make the message warmer or more casual.";
    case "relaxed":
      return "Make the tone more natural and conversational while staying clear and competent. Reduce stiffness. Do not make it informal to the point of sounding unprofessional.";
    case "warm":
      return "Add genuine interpersonal warmth and human presence. This is not about reducing formality — it is about relational presence. Do not make the message gushing or unprofessional. Keep all substance intact.";
    case "trim":
      return "Reduce length only. Remove redundancy, filler, unnecessary preamble, and over-explanation. Do not change tone, register, or substance. Do not rewrite for clarity or style — only cut what is not earning its place.";
    case "academic":
      return "Improve logical structure, precision, and formal reasoning. Sharpen argument flow, tighten logical transitions, and use objective and precise language. Preserve all nuance, hedging, and complexity — do not oversimplify. Do not make the writing warmer or more conversational.";
    case "culture": {
      return [
        "Adjust the message for effective cross-cultural business communication.",
        "",
        "Calibrate these four axes for the given context:",
        "1. Directness — should the main point lead, or be framed with context and cushioning first?",
        "2. Hierarchy — does the recipient's seniority require formal deference, titles, or specific opening/closing conventions?",
        "3. Relationship framing — does this context expect relational warm-up before the business point, or is direct-to-business the norm?",
        "4. Face — does a decline, correction, or firm point need reframing to avoid the recipient losing face?",
        "",
        "Apply only adjustments that genuinely serve the context. Do not overcorrect.",
        "Do not invent region-specific phrases or change the language.",
        "Do not change the substance, intent, or ask.",
        "",
        `Broad region: ${region}`,
        countryId ? `Country: ${countryId}` : null,
        seniority && seniority !== "unknown" ? `Recipient seniority: ${seniority}` : null,
        relationshipStage && relationshipStage !== "unknown" ? `Relationship stage: ${relationshipStage}` : null
      ].filter(Boolean).join("\n");
    }
    default:
      return "Improve presentation while preserving meaning.";
  }
}

export function buildAiPolishMessages(input: AiPolishPromptInput): AiPolishChatMessage[] {
  const requestedCount = input.outputType === "two_options" ? 2 : 1;
  const modifierDefinitions = input.modifiers.map((modifierId) => AI_POLISH_MODIFIERS[modifierId]);
  const activeRegion = input.region ?? "global";
  const isCultureMode = input.mode.id === "culture";
  const outputRules = isCultureMode
    ? [
        "Output rules:",
        "- Return valid JSON only.",
        `- Return exactly ${requestedCount} option${requestedCount === 1 ? "" : "s"}.`,
        "- Each option must include the polished email text AND a culturalNotes array.",
        "- culturalNotes: 2–4 short strings. Each must name the specific adjustment and the reason it fits this context.",
        "- Be specific, not generic. Not 'adjusted for formality' but 'Added recipient title in greeting — standard courtesy in senior Japanese business correspondence'.",
        "- Always include culturalNotes. If the message was already well-calibrated, note what was preserved and why.",
        "- No commentary before or after the JSON."
      ]
    : [
        "Output rules:",
        "- Return valid JSON only.",
        `- Return exactly ${requestedCount} option${requestedCount === 1 ? "" : "s"}.`,
        "- Each option must be ready-to-send text, not analysis.",
        "- Keep the same message, only better presented.",
        "- No commentary before or after the JSON."
      ];

  const systemInstructions = [
    "You are MaxiMail's AI Writing Assistant.",
    BASE_PROMPT,
    "",
    `Mode: ${input.mode.label}`,
    `Mode objective: ${input.mode.objective}`,
    `Mode instructions: ${getModeInstructions(
      input.mode.id,
      activeRegion,
      input.countryId,
      input.seniority,
      input.relationshipStage
    )}`,
    "Apply visible, concrete presentation changes that fit the selected mode.",
    "Do not return text that is identical to the source draft.",
    "",
    modifierDefinitions.length > 0
      ? `Selected modifier instructions:\n${modifierDefinitions
          .map((modifier) => `- ${modifier.label}: ${modifier.promptInfluence}`)
          .join("\n")}`
      : "",
    "",
    outputRules.join("\n")
  ]
    .filter(Boolean)
    .join("\n");

  const userPayload = {
    task: "polish_email_presentation",
    mode: {
      id: input.mode.id,
      label: input.mode.label,
      category: input.mode.category,
      description: input.mode.description
    },
    region: isCultureMode ? activeRegion : null,
    cultureContext: isCultureMode ? {
      broadRegion: input.region ?? "global",
      country: input.countryId ?? null,
      recipientSeniority: input.seniority ?? "unknown",
      relationshipStage: input.relationshipStage ?? "unknown"
    } : null,
    outputType: input.outputType,
    requestedOutputs: requestedCount,
    sourceTarget: input.source.target,
    modifiers: modifierDefinitions.map((modifier) => ({
      id: modifier.id,
      label: modifier.label,
      intent: modifier.intent
    })),
    responseShape: isCultureMode
      ? {
          options: Array.from({ length: requestedCount }, (_, i) => ({
            label: `Option ${i + 1}`,
            text: "culturally adjusted email text",
            culturalNotes: ["Specific adjustment note.", "Another specific adjustment note."]
          }))
        }
      : {
          options: Array.from({ length: requestedCount }, (_, i) => ({
            label: `Option ${i + 1}`,
            text: "presentation-polished email text"
          }))
        },
    sourceText: input.source.text
  };

  return [
    {
      role: "system",
      content: systemInstructions
    },
    {
      role: "user",
      content: JSON.stringify(userPayload)
    }
  ];
}
