import {
  type AiRewriteModeDefinition,
  type AiRewriteModifierId,
  type AiRewriteOutputType,
  AI_REWRITE_GLOBAL_GUARDRAILS,
  AI_REWRITE_MODIFIERS
} from "@/lib/ai-rewrite-modes";

type AiRewritePromptInput = {
  mode: AiRewriteModeDefinition;
  modifiers: AiRewriteModifierId[];
  outputType: AiRewriteOutputType;
  source: {
    target: "selection" | "draft";
    text: string;
  };
};

type AiRewriteChatMessage = {
  role: "system" | "user";
  content: string;
};

export function buildAiRewriteMessages(input: AiRewritePromptInput): AiRewriteChatMessage[] {
  const requestedCount = input.outputType === "two_options" ? 2 : 1;
  const modifierDefinitions = input.modifiers.map((modifierId) => AI_REWRITE_MODIFIERS[modifierId]);

  const systemInstructions = [
    "You are Maximail's AI Writing Assistant.",
    "This is not a generic tone improver. Rewrite the message so it better achieves the selected communication outcome while preserving meaning, intent, and strategic usefulness.",
    "",
    "Global guardrails:",
    ...AI_REWRITE_GLOBAL_GUARDRAILS.map((rule) => `- ${rule}`),
    "",
    "Mode objective:",
    `- ${input.mode.objective}`,
    "",
    "Preserve:",
    ...input.mode.preserveRules.map((rule) => `- ${rule}`),
    "",
    "Avoid:",
    ...input.mode.avoidRules.map((rule) => `- ${rule}`),
    "",
    "Must not:",
    ...input.mode.mustNotRules.map((rule) => `- ${rule}`),
    input.mode.specialRequirement
      ? `\nSpecial mode requirement:\n- ${input.mode.specialRequirement}`
      : "",
    modifierDefinitions.length > 0
      ? `\nSelected modifier instructions:\n${modifierDefinitions
          .map((modifier) => `- ${modifier.label}: ${modifier.promptInfluence}`)
          .join("\n")}`
      : "",
    "",
    "Output rules:",
    "- Return valid JSON only.",
    `- Return exactly ${requestedCount} option${requestedCount === 1 ? "" : "s"}.`,
    "- Each option must be ready-to-send message text, not analysis.",
    "- Do not include commentary before or after the JSON."
  ]
    .filter(Boolean)
    .join("\n");

  const userPayload = {
    task: "rewrite_email_for_outcome",
    mode: {
      id: input.mode.id,
      label: input.mode.label,
      category: input.mode.category,
      description: input.mode.description
    },
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
        text: "rewritten email text"
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
