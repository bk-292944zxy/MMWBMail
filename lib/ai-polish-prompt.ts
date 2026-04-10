import type {
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
  region: AiPolishCultureRegionId
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
        "Adjust the message for cross-cultural business communication.",
        "",
        "Focus only on:",
        "- greeting formality",
        "- appropriate use of names and titles",
        "- level of directness",
        "- courtesy framing",
        "- closing style",
        "",
        "Avoid idioms, slang, or culturally specific assumptions.",
        "Do NOT localize language or invent region-specific phrases.",
        `Region: ${region}`
      ].join("\n");
    default:
      return "Improve presentation while preserving meaning.";
  }
}

export function buildAiPolishMessages(input: AiPolishPromptInput): AiPolishChatMessage[] {
  const requestedCount = input.outputType === "two_options" ? 2 : 1;
  const modifierDefinitions = input.modifiers.map((modifierId) => AI_POLISH_MODIFIERS[modifierId]);
  const activeRegion = input.region ?? "global";

  const systemInstructions = [
    "You are Maximail's AI Writing Assistant.",
    BASE_PROMPT,
    "",
    `Mode: ${input.mode.label}`,
    `Mode instructions: ${getModeInstructions(input.mode.id, activeRegion)}`,
    "",
    modifierDefinitions.length > 0
      ? `Selected modifier instructions:\n${modifierDefinitions
          .map((modifier) => `- ${modifier.label}: ${modifier.promptInfluence}`)
          .join("\n")}`
      : "",
    "",
    "Output rules:",
    "- Return valid JSON only.",
    `- Return exactly ${requestedCount} option${requestedCount === 1 ? "" : "s"}.`,
    "- Each option must be ready-to-send message text, not analysis.",
    "- Keep the same overall message, only better presented.",
    "- Do not include commentary before or after the JSON."
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
    region: input.mode.id === "culture" ? activeRegion : null,
    outputType: input.outputType,
    requestedOutputs: requestedCount,
    sourceTarget: input.source.target,
    modifiers: modifierDefinitions.map((modifier) => ({
      id: modifier.id,
      label: modifier.label,
      intent: modifier.intent
    })),
    responseShape: {
      options: Array.from({ length: requestedCount }, (_, index) => ({
        label: `Option ${index + 1}`,
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
