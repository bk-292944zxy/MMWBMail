export type AiRewriteOutputType = "rewrite" | "two_options";
export const AI_REWRITE_MAX_INPUT_CHARS = 12000;
export const AI_REWRITE_MAX_MODIFIERS = 3;
export const AI_REWRITE_REPEAT_COOLDOWN_MS = 1500;

export type AiRewriteModifierId =
  | "preserve_blunt_honesty"
  | "keep_strong_boundaries"
  | "sound_warmer"
  | "more_concise"
  | "preserve_leverage"
  | "reduce_apology"
  | "add_accountability"
  | "safer_for_leadership"
  | "safer_for_customers"
  | "keep_my_voice"
  | "preserve_nuance"
  | "make_the_ask_clearer";

export type AiRewriteModeId =
  | "deescalate"
  | "reduce_defensiveness"
  | "respectful_but_firm"
  | "repair_trust"
  | "executive_presence"
  | "negotiation_leverage"
  | "polite_no"
  | "clarify_the_ask"
  | "decision_ready"
  | "thought_structure_translator"
  | "social_interpretation_translator";

export type AiRewriteModifierDefinition = {
  id: AiRewriteModifierId;
  label: string;
  intent: string;
  promptInfluence: string;
};

export type AiRewriteModeDefinition = {
  id: AiRewriteModeId;
  label: string;
  category: string;
  description: string;
  objective: string;
  preserveRules: string[];
  avoidRules: string[];
  mustNotRules: string[];
  specialRequirement?: string;
  modifierIds: AiRewriteModifierId[];
  defaultModifierIds?: AiRewriteModifierId[];
};

export const AI_REWRITE_GLOBAL_GUARDRAILS = [
  "Preserve the sender's meaning, intent, and actual ask.",
  "Do not invent facts, promises, dates, concessions, leverage, or commitments.",
  "Do not flatten the writing into generic corporate mush or fake niceness.",
  "Do not accidentally weaken necessary boundaries, accountability, or leverage.",
  "Keep names, numbers, links, and concrete details accurate unless the source explicitly changes them.",
  "Preserve the writer's voice where possible rather than sandblasting it away.",
  "Return only the requested rewritten output in valid JSON."
] as const;

export const AI_REWRITE_MODIFIERS: Record<AiRewriteModifierId, AiRewriteModifierDefinition> = {
  preserve_blunt_honesty: {
    id: "preserve_blunt_honesty",
    label: "Preserve blunt honesty",
    intent: "Keep direct truthfulness intact.",
    promptInfluence:
      "Retain plainspoken honesty and directness instead of sanding the message into polite vagueness."
  },
  keep_strong_boundaries: {
    id: "keep_strong_boundaries",
    label: "Keep strong boundaries",
    intent: "Protect firm limits and non-negotiables.",
    promptInfluence:
      "Keep the message's boundaries unmistakable and do not reopen what the writer is closing."
  },
  sound_warmer: {
    id: "sound_warmer",
    label: "Sound warmer",
    intent: "Add more human warmth without becoming fake.",
    promptInfluence:
      "Introduce modest warmth and relational safety while avoiding fake sweetness or submissiveness."
  },
  more_concise: {
    id: "more_concise",
    label: "More concise",
    intent: "Reduce extra wording and filler.",
    promptInfluence:
      "Tighten structure, trim filler, and shorten where possible without dropping necessary meaning."
  },
  preserve_leverage: {
    id: "preserve_leverage",
    label: "Preserve leverage",
    intent: "Protect negotiating position and optionality.",
    promptInfluence:
      "Avoid accidental concessions, visible neediness, or language that weakens the sender's position."
  },
  reduce_apology: {
    id: "reduce_apology",
    label: "Reduce apology",
    intent: "Remove self-undermining apology habits.",
    promptInfluence:
      "Cut unnecessary apologetic framing and hedging unless a real apology is core to the message."
  },
  add_accountability: {
    id: "add_accountability",
    label: "Add accountability",
    intent: "Make ownership and responsibility clearer.",
    promptInfluence:
      "Clarify responsibility, impact, or ownership where appropriate without fabricating admissions."
  },
  safer_for_leadership: {
    id: "safer_for_leadership",
    label: "Safer for leadership",
    intent: "Make the message more review-safe for senior decision makers.",
    promptInfluence:
      "Reduce reactive phrasing and make the message easier for leaders to process quickly and confidently."
  },
  safer_for_customers: {
    id: "safer_for_customers",
    label: "Safer for customers",
    intent: "Make the message more externally appropriate and clearer.",
    promptInfluence:
      "Keep the message customer-safe, crisp, and trust-preserving without turning it sterile."
  },
  keep_my_voice: {
    id: "keep_my_voice",
    label: "Keep my voice",
    intent: "Preserve the writer's natural cadence and personality.",
    promptInfluence:
      "Preserve the writer's recognizable tone and cadence rather than recasting it into generic polished prose."
  },
  preserve_nuance: {
    id: "preserve_nuance",
    label: "Preserve nuance",
    intent: "Keep complexity and layered reasoning intact.",
    promptInfluence:
      "Preserve important caveats, reasoning chains, and texture instead of oversimplifying the message."
  },
  make_the_ask_clearer: {
    id: "make_the_ask_clearer",
    label: "Make the ask clearer",
    intent: "Bring the request or action needed into sharper focus.",
    promptInfluence:
      "Surface the actual ask, next step, or decision needed so the recipient can act on it faster."
  }
};

export const AI_REWRITE_MODES: AiRewriteModeDefinition[] = [
  {
    id: "deescalate",
    label: "Deescalate",
    category: "Ease tension",
    description: "Lower the temperature without losing your point.",
    objective:
      "Keep the real complaint and accountability intact while removing escalation signals that make resolution less likely.",
    preserveRules: [
      "Preserve the core complaint, grievance, or concern.",
      "Preserve the specific issue that needs to be addressed.",
      "Preserve legitimate boundaries, expectations, and accountability where present."
    ],
    avoidRules: [
      "Avoid contempt, ridicule, sarcasm, taunting, and rhetorical attack questions.",
      "Avoid mind-reading, motive attribution, and identity-based attacks.",
      "Avoid broad absolutes like 'always' or 'never' unless factually unavoidable."
    ],
    mustNotRules: [
      "Do not soften away the issue, ask, or accountability.",
      "Do not flatten this into HR-speak, fake niceness, or conflict-avoidant mush.",
      "Do not preserve verbal aggression just because the source message is emotional."
    ],
    specialRequirement:
      "Deescalate means keep the issue and remove the heat: frame the problem as concrete behavior + impact + clear ask/next step, with directness but no humiliation.",
    modifierIds: [
      "sound_warmer",
      "more_concise",
      "add_accountability",
      "keep_strong_boundaries",
      "preserve_blunt_honesty"
    ],
    defaultModifierIds: ["sound_warmer", "more_concise", "add_accountability"]
  },
  {
    id: "reduce_defensiveness",
    label: "Reduce Defensiveness",
    category: "Ease tension",
    description:
      "Say the same thing in a way the other person is less likely to react against.",
    objective:
      "Keep the concern and ask intact while reducing the chance that the recipient becomes reactive or guarded.",
    preserveRules: [
      "Preserve the actual request.",
      "Preserve the real concern.",
      "Make cooperation easier without hiding the issue."
    ],
    avoidRules: [
      "Avoid blame-signaling phrasing.",
      "Avoid wording that implies incompetence or moral failure.",
      "Avoid cornering language and passive-aggressive tone."
    ],
    mustNotRules: [
      "Do not remove accountability where it matters.",
      "Do not turn the message into conflict-avoidant but useless mush."
    ],
    modifierIds: [
      "sound_warmer",
      "more_concise",
      "make_the_ask_clearer",
      "add_accountability",
      "preserve_blunt_honesty"
    ]
  },
  {
    id: "respectful_but_firm",
    label: "Respectful but Firm",
    category: "Ease tension",
    description: "Keep the boundary, remove the edge.",
    objective: "Keep the boundary while removing unnecessary antagonism.",
    preserveRules: [
      "Preserve the user's boundary.",
      "Preserve a calm, self-possessed stance."
    ],
    avoidRules: [
      "Avoid hostility, over-apology, and rambling explanations.",
      "Avoid submissive language."
    ],
    mustNotRules: [
      "Do not weaken the no.",
      "Do not add softness that invites avoidable pushback."
    ],
    modifierIds: [
      "keep_strong_boundaries",
      "reduce_apology",
      "sound_warmer",
      "more_concise",
      "preserve_blunt_honesty"
    ]
  },
  {
    id: "repair_trust",
    label: "Repair Trust",
    category: "Ease tension",
    description: "Reopen productive dialogue after friction, confusion, or disappointment.",
    objective:
      "Help the writer acknowledge friction or disappointment and reopen productive dialogue.",
    preserveRules: [
      "Preserve seriousness.",
      "Allow accountability where it genuinely exists.",
      "Sound sincere and constructive."
    ],
    avoidRules: [
      "Avoid empty corporate apology language.",
      "Avoid melodrama and self-justifying tone."
    ],
    mustNotRules: [
      "Do not fabricate admissions not present in the original.",
      "Do not over-sentimentalize the message."
    ],
    modifierIds: [
      "add_accountability",
      "sound_warmer",
      "more_concise",
      "keep_my_voice",
      "preserve_nuance"
    ]
  },
  {
    id: "executive_presence",
    label: "Executive Presence",
    category: "Strengthen your position",
    description: "Sound clearer, more decisive, and more authoritative.",
    objective:
      "Lead with the core point, reduce self-undermining language, and project calm authority without aggression.",
    preserveRules: [
      "Preserve the writer's real decision need, rationale, and intended outcome.",
      "Preserve personality where it helps clarity and credibility."
    ],
    avoidRules: [
      "Avoid sarcasm, passive-aggressive lines, and cluttered verbal buildup.",
      "Avoid excessive hedging, apology-heavy framing, and self-minimizing language."
    ],
    mustNotRules: [
      "Do not confuse authority with hostility.",
      "Do not preserve volatility or messiness under the banner of voice."
    ],
    specialRequirement:
      "Move the key point earlier, tighten sentence structure, and replace emotional explanation with direct rationale.",
    modifierIds: [
      "more_concise",
      "reduce_apology",
      "keep_strong_boundaries",
      "safer_for_leadership",
      "keep_my_voice"
    ],
    defaultModifierIds: ["more_concise", "reduce_apology", "safer_for_leadership"]
  },
  {
    id: "negotiation_leverage",
    label: "Negotiation Leverage",
    category: "Strengthen your position",
    description: "Protect your position without sounding combative.",
    objective:
      "Protect value and reciprocity with calm constraints, clear asks, and no bluffing.",
    preserveRules: [
      "Preserve leverage, optionality, and reciprocal expectations.",
      "Preserve clear constraints, consequences, and next steps where present."
    ],
    avoidRules: [
      "Avoid desperation, overexplaining, and accidental concession language.",
      "Avoid threat theater; use controlled boundary-and-consequence statements."
    ],
    mustNotRules: [
      "Do not bluff, invent leverage, or fabricate legal/commercial claims.",
      "Do not over-soften until the ask or constraints become unclear."
    ],
    specialRequirement:
      "Clarify the ask, avoid unnecessary concessions, and require reciprocal movement where appropriate.",
    modifierIds: [
      "preserve_leverage",
      "more_concise",
      "keep_strong_boundaries",
      "add_accountability",
      "reduce_apology",
      "safer_for_leadership",
      "keep_my_voice"
    ],
    defaultModifierIds: ["keep_strong_boundaries", "more_concise", "add_accountability"]
  },
  {
    id: "polite_no",
    label: "Polite No",
    category: "Strengthen your position",
    description: "Decline clearly without rambling, guilt, or weakness.",
    objective:
      "Deliver a clear refusal without hostility, loopholes, or ambiguity.",
    preserveRules: [
      "Preserve the no.",
      "Preserve relationship where possible without weakening the refusal."
    ],
    avoidRules: [
      "Avoid rambling rationale and softening that converts a no into a maybe.",
      "Avoid guilt-language and apology spirals."
    ],
    mustNotRules: [
      "Do not reopen what should remain closed.",
      "Do not create false hope unless the original explicitly does."
    ],
    specialRequirement:
      "State the no plainly, keep rationale brief, and only offer alternatives when the source clearly intends one.",
    modifierIds: [
      "keep_strong_boundaries",
      "sound_warmer",
      "more_concise",
      "reduce_apology",
      "preserve_blunt_honesty",
      "keep_my_voice"
    ],
    defaultModifierIds: ["keep_strong_boundaries", "more_concise", "sound_warmer"]
  },
  {
    id: "clarify_the_ask",
    label: "Clarify the Ask",
    category: "Make it easier to act on",
    description: "Make the actual request obvious and easy to act on.",
    objective:
      "Surface the real request early, make expected action explicit, and reduce friction between reading and acting.",
    preserveRules: [
      "Preserve essential context so the ask remains understandable and appropriate.",
      "Preserve cooperative tone while making action clearer."
    ],
    avoidRules: [
      "Avoid burying the ask under background narrative.",
      "Avoid abrupt commands that drop necessary context."
    ],
    mustNotRules: [
      "Do not turn a request into a demand unless the source clearly intends that.",
      "Do not remove nuance that the ask depends on."
    ],
    specialRequirement:
      "Identify the actual request, move it earlier, and express it with direct action language while keeping enough context to act.",
    modifierIds: [
      "make_the_ask_clearer",
      "more_concise",
      "add_accountability",
      "sound_warmer",
      "preserve_nuance",
      "keep_my_voice"
    ],
    defaultModifierIds: ["more_concise", "add_accountability", "sound_warmer"]
  },
  {
    id: "decision_ready",
    label: "Decision-Ready",
    category: "Make it easier to act on",
    description: "Turn this into something easier to review, approve, or respond to quickly.",
    objective:
      "Frame the message as a clear decision moment so the recipient can choose and move forward without follow-up clarification.",
    preserveRules: [
      "Preserve real constraints, tradeoffs, and decision-relevant context.",
      "Preserve audience-appropriate tone while clarifying decision ownership."
    ],
    avoidRules: [
      "Avoid open-ended discussion framing when a decision is actually needed.",
      "Avoid narrative sprawl that hides the decision and next step."
    ],
    mustNotRules: [
      "Do not invent options, recommendations, or constraints not grounded in the source.",
      "Do not blur a required decision into a vague check-in."
    ],
    specialRequirement:
      "State what decision is needed, surface options/recommendation only when supported by the source, and clarify what happens next after the decision.",
    modifierIds: [
      "more_concise",
      "add_accountability",
      "keep_strong_boundaries",
      "sound_warmer",
      "make_the_ask_clearer",
      "preserve_nuance",
      "safer_for_leadership",
      "safer_for_customers"
    ],
    defaultModifierIds: ["more_concise", "add_accountability"]
  },
  {
    id: "thought_structure_translator",
    label: "Thought Structure Translator",
    category: "Translate how it lands",
    description: "Turn layered or bottom-up thinking into a message people can follow faster.",
    objective:
      "Reorganize ideas so the message is easier to follow and process while preserving intent, nuance, and voice.",
    preserveRules: [
      "Preserve original ideas, nuance, and intent.",
      "Preserve important reasoning chains and context."
    ],
    avoidRules: [
      "Avoid flattening complexity into generic writing.",
      "Avoid rigid template formatting unless the source clearly calls for it."
    ],
    mustNotRules: [
      "Do not over-summarize away key context.",
      "Do not change meaning or introduce new arguments."
    ],
    specialRequirement:
      "Use top-down flow: main point early, then grouped supporting detail; reduce cognitive load without reducing substance.",
    modifierIds: [
      "more_concise",
      "keep_my_voice",
      "add_accountability",
      "preserve_nuance",
      "keep_strong_boundaries",
      "preserve_blunt_honesty"
    ],
    defaultModifierIds: ["more_concise", "keep_my_voice"]
  },
  {
    id: "social_interpretation_translator",
    label: "Social Interpretation Translator",
    category: "Translate how it lands",
    description: "Help your real meaning land the way you intended.",
    objective:
      "Align how the message is perceived with what the sender actually means without changing purpose or core stance.",
    preserveRules: [
      "Preserve core meaning, intent, and key message.",
      "Preserve needed boundaries and intended edge when relevant."
    ],
    avoidRules: [
      "Avoid over-softening or over-strengthening beyond intended tone.",
      "Avoid introducing new arguments or changing message purpose."
    ],
    mustNotRules: [
      "Do not distort meaning.",
      "Do not remove intended directness when it is part of the message.",
      "Do not collapse into generic corporate language."
    ],
    specialRequirement:
      "Adjust tone, implication, and interpersonal signal so the message lands closer to intended meaning.",
    modifierIds: [
      "keep_my_voice",
      "sound_warmer",
      "keep_strong_boundaries",
      "more_concise",
      "preserve_blunt_honesty"
    ],
    defaultModifierIds: ["keep_my_voice", "sound_warmer"]
  }
];

export const AI_REWRITE_CATEGORY_ORDER = [
  "Ease tension",
  "Strengthen your position",
  "Make it easier to act on",
  "Translate how it lands"
] as const;

export function getAiRewriteModeDefinition(modeId: string) {
  return AI_REWRITE_MODES.find((mode) => mode.id === modeId) ?? null;
}

export function getAiRewriteModifierDefinition(modifierId: string) {
  return AI_REWRITE_MODIFIERS[modifierId as AiRewriteModifierId] ?? null;
}

export function getAiRewriteModifierDefinitionsForMode(modeId: AiRewriteModeId) {
  const mode = getAiRewriteModeDefinition(modeId);
  if (!mode) {
    return [];
  }

  return mode.modifierIds.map((modifierId) => AI_REWRITE_MODIFIERS[modifierId]);
}

export function getAiRewriteDefaultModifiersForMode(modeId: AiRewriteModeId) {
  const mode = getAiRewriteModeDefinition(modeId);
  if (!mode?.defaultModifierIds?.length) {
    return [] as AiRewriteModifierId[];
  }
  return [...mode.defaultModifierIds];
}

export function areAiRewriteModifiersValid(
  modeId: AiRewriteModeId,
  modifierIds: string[]
) {
  const allowedIds = new Set(getAiRewriteModifierDefinitionsForMode(modeId).map((item) => item.id));
  return modifierIds.every((modifierId) => allowedIds.has(modifierId as AiRewriteModifierId));
}
