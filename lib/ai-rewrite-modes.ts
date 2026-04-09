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
    objective: "Lower emotional temperature while preserving the core point.",
    preserveRules: [
      "Preserve factual content.",
      "Preserve the actual concern.",
      "Preserve necessary boundaries when they matter."
    ],
    avoidRules: [
      "Avoid inflammatory phrasing, courtroom tone, and unnecessary absolutes.",
      "Avoid fake warmth or forced niceness."
    ],
    mustNotRules: [
      "Do not turn the message into vague mush.",
      "Do not invent concessions or soften away the issue."
    ],
    modifierIds: [
      "preserve_blunt_honesty",
      "keep_strong_boundaries",
      "sound_warmer",
      "more_concise",
      "add_accountability"
    ]
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
      "preserve_blunt_honesty",
      "sound_warmer",
      "more_concise",
      "make_the_ask_clearer",
      "add_accountability"
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
      "Make the writing clearer, more decisive, more authoritative, and less self-undermining.",
    preserveRules: [
      "Preserve the writer's actual point.",
      "Improve structure and signal."
    ],
    avoidRules: [
      "Avoid pompousness, stiffness, and bloated formalism.",
      "Reduce hedging, filler, and self-undermining phrasing."
    ],
    mustNotRules: [
      "Do not turn the message into parody corporate language.",
      "Do not replace substance with polish."
    ],
    modifierIds: [
      "more_concise",
      "reduce_apology",
      "keep_strong_boundaries",
      "safer_for_leadership",
      "keep_my_voice"
    ]
  },
  {
    id: "negotiation_leverage",
    label: "Negotiation Leverage",
    category: "Strengthen your position",
    description: "Protect your position without sounding combative.",
    objective:
      "Protect the writer's position and optionality without sounding reactive or combative.",
    preserveRules: [
      "Preserve leverage and optionality.",
      "Preserve commercially aware, controlled positioning."
    ],
    avoidRules: [
      "Avoid overexplaining.",
      "Avoid self-undermining urgency.",
      "Avoid accidental concession language."
    ],
    mustNotRules: [
      "Do not become aggressive for its own sake.",
      "Do not invent legal or commercial positions not present in the source."
    ],
    modifierIds: [
      "preserve_leverage",
      "more_concise",
      "keep_strong_boundaries",
      "reduce_apology",
      "safer_for_leadership"
    ]
  },
  {
    id: "polite_no",
    label: "Polite No",
    category: "Strengthen your position",
    description: "Decline clearly without rambling, guilt, or weakness.",
    objective: "Decline clearly and cleanly without guilt, apology spirals, or ambiguity.",
    preserveRules: [
      "Preserve the no.",
      "Preserve relationship where possible."
    ],
    avoidRules: [
      "Avoid rambling, overexplaining, and softening into ambiguity.",
      "Reduce guilt language."
    ],
    mustNotRules: [
      "Do not reopen what should remain closed.",
      "Do not create false hope unless the original explicitly does."
    ],
    modifierIds: [
      "keep_strong_boundaries",
      "sound_warmer",
      "more_concise",
      "reduce_apology",
      "preserve_blunt_honesty"
    ]
  },
  {
    id: "clarify_the_ask",
    label: "Clarify the Ask",
    category: "Make it easier to act on",
    description: "Make the actual request obvious and easy to act on.",
    objective: "Make the actual request or needed action obvious.",
    preserveRules: [
      "Preserve necessary context for understanding the ask.",
      "Make response and action easier."
    ],
    avoidRules: [
      "Avoid hiding the request inside background detail.",
      "Avoid overexpansion."
    ],
    mustNotRules: [
      "Do not strip away context that is necessary for understanding the ask."
    ],
    modifierIds: [
      "make_the_ask_clearer",
      "more_concise",
      "preserve_nuance",
      "keep_my_voice",
      "safer_for_leadership"
    ]
  },
  {
    id: "decision_ready",
    label: "Decision-Ready",
    category: "Make it easier to act on",
    description: "Turn this into something easier to review, approve, or respond to quickly.",
    objective:
      "Turn the message into something easier to review, approve, or respond to quickly.",
    preserveRules: [
      "Preserve important nuance that changes the decision.",
      "Clarify next step and decision need."
    ],
    avoidRules: [
      "Avoid excessive detail.",
      "Avoid multiple muddy asks.",
      "Avoid unclear ownership."
    ],
    mustNotRules: [
      "Do not oversimplify nuance that materially changes the decision."
    ],
    modifierIds: [
      "more_concise",
      "make_the_ask_clearer",
      "preserve_nuance",
      "safer_for_leadership",
      "safer_for_customers"
    ]
  },
  {
    id: "thought_structure_translator",
    label: "Thought Structure Translator",
    category: "Translate how it lands",
    description: "Turn layered or bottom-up thinking into a message people can follow faster.",
    objective:
      "Translate layered, bottom-up, context-first thinking into a more top-down, trackable communication structure.",
    preserveRules: [
      "Preserve nuance and intelligence.",
      "Preserve reasoning chains that matter.",
      "Reorganize supporting detail under clearer structure."
    ],
    avoidRules: [
      "Avoid flattening complexity.",
      "Avoid corporate sanitization.",
      "Avoid dumbing down the writer's thinking."
    ],
    mustNotRules: [
      "Do not erase reasoning chains that matter.",
      "Do not make the writer sound generic or simplistic."
    ],
    specialRequirement:
      "This mode is about cognitive structure translation, not tone softening.",
    modifierIds: [
      "preserve_nuance",
      "more_concise",
      "keep_strong_boundaries",
      "make_the_ask_clearer",
      "keep_my_voice"
    ]
  },
  {
    id: "social_interpretation_translator",
    label: "Social Interpretation Translator",
    category: "Translate how it lands",
    description: "Help your real meaning land the way you intended.",
    objective:
      "Help the writer's real meaning land the way they intended by reducing social misread risk.",
    preserveRules: [
      "Preserve the actual meaning.",
      "Keep necessary boundaries intact.",
      "Add socially expected framing only where useful."
    ],
    avoidRules: [
      "Avoid fake warmth, forced niceness, and unnecessary softness.",
      "Avoid making the writer sound fake or submissive."
    ],
    mustNotRules: [
      "Do not distort meaning.",
      "Do not erase directness when it matters.",
      "Do not turn the message into people-pleasing fluff."
    ],
    specialRequirement:
      "This mode is about social interpretation translation, not structure repair.",
    modifierIds: [
      "preserve_blunt_honesty",
      "keep_strong_boundaries",
      "sound_warmer",
      "more_concise",
      "keep_my_voice"
    ]
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

export function areAiRewriteModifiersValid(
  modeId: AiRewriteModeId,
  modifierIds: string[]
) {
  const allowedIds = new Set(getAiRewriteModifierDefinitionsForMode(modeId).map((item) => item.id));
  return modifierIds.every((modifierId) => allowedIds.has(modifierId as AiRewriteModifierId));
}
