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

function getDeescalateModeInstructions(modifiers: AiRewriteModifierId[]) {
  const selected = new Set(modifiers);
  const lines = [
    "Deescalate strategy:",
    "- Keep the complaint, concern, or boundary; remove heat that blocks progress.",
    "- Replace character judgments with concrete behavior descriptions.",
    "- Replace global accusations with specific incidents/patterns when available.",
    "- Keep impact clear and end with an actionable request, expectation, or next step.",
    "- Keep the message human and recognizable, not sterile or submissive."
  ];

  if (selected.has("sound_warmer")) {
    lines.push(
      "- Sound warmer: soften openings/closings and loaded wording while preserving the complaint."
    );
  }
  if (selected.has("more_concise")) {
    lines.push(
      "- More concise: remove repeated grievance material; keep core issue, impact, and ask."
    );
  }
  if (selected.has("add_accountability")) {
    lines.push(
      "- Add accountability: make expected correction or next step explicit without threat theater."
    );
  }
  if (selected.has("keep_strong_boundaries")) {
    lines.push(
      "- Keep strong boundaries: keep non-negotiable lines clear; remove aggression, not firmness."
    );
  }
  if (selected.has("preserve_blunt_honesty")) {
    lines.push(
      "- Preserve blunt honesty: keep candor and directness, but do not keep contempt, mockery, or volatility."
    );
  }
  if (selected.has("keep_my_voice")) {
    lines.push(
      "- Keep my voice: preserve cadence/personality, but never preserve contempt or threat energy."
    );
  }

  lines.push(
    "- Never moralize, humiliate, mind-read motives, or use retaliatory framing.",
    "- Reduced heat must not reduce seriousness."
  );

  return lines.join("\n");
}

function getStrengthenPositionInstructions(
  modeId: AiRewriteModeDefinition["id"],
  modifiers: AiRewriteModifierId[]
) {
  const selected = new Set(modifiers);

  if (modeId === "executive_presence") {
    const lines = [
      "Executive Presence strategy:",
      "- Lead with the key point and needed decision earlier.",
      "- Tighten structure, remove hedging, and keep rationale direct.",
      "- Keep authoritative calm; authority is not aggression."
    ];
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove caveats, repeated explanation, and defensive buildup.");
    }
    if (selected.has("reduce_apology")) {
      lines.push("- Reduce apology: strip unnecessary deference and weakening apology habits.");
    }
    if (selected.has("safer_for_leadership")) {
      lines.push(
        "- Safer for leadership: remove pettiness/volatility and keep executive-review-safe tone."
      );
    }
    if (selected.has("keep_my_voice")) {
      lines.push("- Keep my voice: preserve personality, not chaos, messiness, or volatility.");
    }
    lines.push(
      "- Do not use sarcasm, passive-aggressive framing, or cluttered emotional explanation."
    );
    return lines.join("\n");
  }

  if (modeId === "negotiation_leverage") {
    const lines = [
      "Negotiation Leverage strategy:",
      "- Protect value and reciprocity while staying controlled and non-reactive.",
      "- Convert threats into calm constraints, boundaries, consequences, or next steps.",
      "- Clarify the ask and expected reciprocal movement."
    ];
    if (selected.has("keep_strong_boundaries")) {
      lines.push("- Keep strong boundaries: preserve non-negotiables and avoid appeasing drift.");
    }
    if (selected.has("add_accountability")) {
      lines.push(
        "- Add accountability: make reciprocal action, expectation, or ownership explicit."
      );
    }
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove over-explaining and defensive framing.");
    }
    if (selected.has("keep_my_voice")) {
      lines.push(
        "- Keep my voice: preserve recognizable cadence, but never preserve instability, hostility, or reactive tone."
      );
    }
    lines.push("- Never bluff, invent leverage, or add fabricated legal/commercial claims.");
    return lines.join("\n");
  }

  if (modeId === "polite_no") {
    const lines = [
      "Polite No strategy:",
      "- State the refusal plainly and unambiguously.",
      "- Keep rationale brief; offer an alternative only when the source clearly intends one.",
      "- Keep relational tone clean without reopening the decision."
    ];
    if (selected.has("keep_strong_boundaries")) {
      lines.push("- Keep strong boundaries: preserve the no as a real no.");
    }
    if (selected.has("sound_warmer")) {
      lines.push("- Sound warmer: soften tone without weakening leverage or clarity.");
    }
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove loopholes and extra explanation.");
    }
    if (selected.has("keep_my_voice")) {
      lines.push(
        "- Keep my voice: preserve personality while keeping the refusal explicit, respectful, and unambiguous."
      );
    }
    lines.push("- Do not turn the refusal into an ambiguous non-answer.");
    return lines.join("\n");
  }

  return "";
}

function getActionabilityModeInstructions(
  modeId: AiRewriteModeDefinition["id"],
  modifiers: AiRewriteModifierId[]
) {
  const selected = new Set(modifiers);

  if (modeId === "clarify_the_ask") {
    const lines = [
      "Clarify the Ask strategy:",
      "- Identify the actual request, even if it is implied or buried.",
      "- Move the ask earlier and use direct action verbs when possible.",
      "- Keep only essential context needed for the recipient to act."
    ];
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove excess background and repetition; keep ask + essential context.");
    }
    if (selected.has("add_accountability")) {
      lines.push("- Add accountability: clarify who needs to do what and the next step.");
    }
    if (selected.has("sound_warmer")) {
      lines.push("- Sound warmer: keep cooperative tone without blurring the action needed.");
    }
    if (selected.has("keep_my_voice")) {
      lines.push("- Keep my voice: preserve cadence/personality, but do not preserve vagueness.");
    }
    lines.push(
      "- Do not leave the recipient guessing what action is requested.",
      "- Do not turn the ask into a hard demand unless the source clearly intends it."
    );
    return lines.join("\n");
  }

  if (modeId === "decision_ready") {
    const lines = [
      "Decision-Ready strategy:",
      "- Determine whether a decision is being requested and frame it explicitly when appropriate.",
      "- State what decision is needed and what happens next after that decision.",
      "- Present decision-relevant context in a scannable, concise structure."
    ];
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove narrative sprawl and prioritize decision-relevant information.");
    }
    if (selected.has("add_accountability")) {
      lines.push("- Add accountability: clarify owner, next step, and timing where implied.");
    }
    if (selected.has("keep_strong_boundaries")) {
      lines.push("- Keep strong boundaries: reinforce required decisions or timelines when needed.");
    }
    if (selected.has("sound_warmer")) {
      lines.push("- Sound warmer: soften tone for sensitive recipients without blurring the decision.");
    }
    lines.push(
      "- Do not invent options, recommendations, or structure not grounded in the original.",
      "- Do not convert a decision request into a vague discussion thread."
    );
    return lines.join("\n");
  }

  return "";
}

function getTranslateLandingModeInstructions(
  modeId: AiRewriteModeDefinition["id"],
  modifiers: AiRewriteModifierId[]
) {
  const selected = new Set(modifiers);

  if (modeId === "social_interpretation_translator") {
    const lines = [
      "Social Interpretation Translator strategy:",
      "- Infer likely social interpretation of the source and identify where tone/implication may misfire.",
      "- Keep the same message purpose and core content while adjusting how it lands.",
      "- Reduce unintended harshness, passivity, or ambiguity with more precise interpersonal signals."
    ];
    if (selected.has("keep_my_voice")) {
      lines.push(
        "- Keep my voice: preserve cadence and personality while removing mockery, awkwardness, or distortion."
      );
    }
    if (selected.has("sound_warmer")) {
      lines.push("- Sound warmer: reduce unintended coldness/sharpness without weakening intended stance.");
    }
    if (selected.has("keep_strong_boundaries")) {
      lines.push("- Keep strong boundaries: ensure translation does not soften away core boundaries.");
    }
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove clutter that distorts perceived intent.");
    }
    lines.push(
      "- Do not introduce new arguments, and do not over-correct tone beyond what is needed."
    );
    return lines.join("\n");
  }

  if (modeId === "thought_structure_translator") {
    const lines = [
      "Thought Structure Translator strategy:",
      "- Identify the core point and surface it early.",
      "- Reorganize into a logical top-down flow: main point first, grouped supporting detail second.",
      "- Preserve ideas and nuance while reducing cognitive load and repetition."
    ];
    if (selected.has("more_concise")) {
      lines.push("- More concise: remove redundancy and tighten transitions between ideas.");
    }
    if (selected.has("keep_my_voice")) {
      lines.push("- Keep my voice: preserve natural style while improving structure and readability.");
    }
    if (selected.has("add_accountability")) {
      lines.push(
        "- Add accountability: when action is involved, clarify next step ownership without inventing obligations."
      );
    }
    lines.push(
      "- Do not over-summarize, and do not force rigid list formatting unless it fits the source."
    );
    return lines.join("\n");
  }

  return "";
}

export function buildAiRewriteMessages(input: AiRewritePromptInput): AiRewriteChatMessage[] {
  const requestedCount = input.outputType === "two_options" ? 2 : 1;
  const modifierDefinitions = input.modifiers.map((modifierId) => AI_REWRITE_MODIFIERS[modifierId]);
  const modeSpecificInstructions =
    input.mode.id === "deescalate"
      ? getDeescalateModeInstructions(input.modifiers)
      : getStrengthenPositionInstructions(input.mode.id, input.modifiers) ||
        getActionabilityModeInstructions(input.mode.id, input.modifiers) ||
        getTranslateLandingModeInstructions(input.mode.id, input.modifiers);

  const systemInstructions = [
    "You are MaxiMail's AI Writing Assistant.",
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
    modeSpecificInstructions ? `\nMode-specific guidance:\n${modeSpecificInstructions}` : "",
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
