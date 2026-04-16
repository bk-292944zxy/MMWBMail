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

function getProfessionalModeInstructions(modifiers: AiPolishModifierId[]) {
  const selected = new Set(modifiers);
  const lines = [
    "Professional mode strategy:",
    "- Preserve core intent, ask, stance, and meaning.",
    "- Improve wording precision, sentence quality, and paragraph flow.",
    "- Reduce draft sloppiness, uneven rhythm, and avoidable roughness without changing agenda."
  ];

  if (selected.has("concise")) {
    lines.push(
      "- More concise: remove redundancy and over-explanation while keeping context needed for credibility."
    );
  }
  if (selected.has("structure")) {
    lines.push(
      "- Add structure: improve sequencing, transitions, and grouping so the message feels intentional and easy to trust."
    );
  }
  if (selected.has("stronger")) {
    lines.push(
      "- Stronger tone: increase confidence slightly, but stay in presentation-polish lane (not leverage or social-strategy mode)."
    );
  }
  if (selected.has("softer")) {
    lines.push(
      "- Softer tone: smooth unnecessary abrasion without becoming appeasing or weakening a firm point."
    );
  }
  if (selected.has("detailed")) {
    lines.push(
      "- More detailed: add completion only where thin writing harms credibility; do not invent facts or rationale."
    );
  }
  if (selected.has("shorter")) {
    lines.push(
      "- Shorter: trim aggressively where bloated, but keep full substantive meaning and necessary context."
    );
  }

  lines.push(
    "- Do not drift into Elevate-style social-outcome rewriting.",
    "- Do not force executive cliché, corporate filler, or sterile tone.",
    "- Keep the message human and recognizable."
  );

  return lines.join("\n");
}

function getModeInstructions(
  mode: AiPolishModeDefinition["id"],
  region: AiPolishCultureRegionId,
  countryId?: AiPolishCultureCountryId,
  seniority?: AiPolishCultureRecipientSeniority,
  relationshipStage?: AiPolishCultureRelationshipStage
) {
  switch (mode) {
    case "clean":
      return "Improve clarity and flow. Remove redundancy, tighten phrasing, and improve readability. Keep tone neutral.";
    case "formal":
      return "Increase formality and courtesy. Use complete phrasing, structured sentences, and traditional professional tone. Reduce contractions.";
    case "relaxed":
      return "Make the tone more natural and conversational while staying clear and competent. Reduce stiffness and formality.";
    case "professional":
      return "Use a modern business tone. Surface the main point clearly, keep phrasing direct and competent, and ensure the message is easy to act on.";
    case "academic":
      return "Improve logical flow and precision. Use structured reasoning, clear transitions, and a formal, objective tone.";
    case "culture":
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
      ].join("\n");
    default:
      return "Improve presentation while preserving meaning.";
  }
}

export function buildAiPolishMessages(input: AiPolishPromptInput): AiPolishChatMessage[] {
  const requestedCount = input.outputType === "two_options" ? 2 : 1;
  const modifierDefinitions = input.modifiers.map((modifierId) => AI_POLISH_MODIFIERS[modifierId]);
  const activeRegion = input.region ?? "global";
  const isCultureMode = input.mode.id === "culture";
  const modeSpecificInstructions =
    input.mode.id === "professional" ? getProfessionalModeInstructions(input.modifiers) : "";
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
    `Mode instructions: ${getModeInstructions(
      input.mode.id,
      activeRegion,
      input.countryId,
      input.seniority,
      input.relationshipStage
    )}`,
    modeSpecificInstructions ? `\nMode-specific guidance:\n${modeSpecificInstructions}` : "",
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
