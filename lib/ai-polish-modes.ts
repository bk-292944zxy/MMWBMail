import {
  AI_REWRITE_MAX_MODIFIERS
} from "@/lib/ai-rewrite-modes";

export const AI_POLISH_MAX_MODIFIERS = AI_REWRITE_MAX_MODIFIERS;

export type AiPolishModifierId =
  | "shorter"
  | "concise"
  | "detailed"
  | "softer"
  | "stronger"
  | "structure"
  | "less_direct"
  | "more_direct"
  | "increase_formality"
  | "relationship_opening"
  | "face_preserving";

export type AiPolishModeId =
  | "clean"
  | "formal"
  | "relaxed"
  | "warm"
  | "trim"
  | "culture"
  | "academic"
  ;

export type AiPolishCultureBroadRegionId =
  | "global" | "east_asia" | "south_asia" | "mena"
  | "western_europe" | "northern_europe" | "north_america"
  | "latin_america" | "ssa";

export type AiPolishCultureCountryId =
  | "jp" | "cn" | "kr" | "tw"
  | "in" | "pk" | "bd" | "lk"
  | "sa" | "ae" | "eg" | "tr"
  | "de" | "fr" | "it" | "es" | "nl"
  | "se" | "no" | "dk" | "fi"
  | "us" | "ca" | "au" | "gb"
  | "br" | "mx" | "ar" | "co"
  | "ng" | "za" | "ke" | "gh";

export type AiPolishCultureRegionId = AiPolishCultureBroadRegionId; // backwards compat

export type AiPolishCultureRecipientSeniority =
  | "peer" | "senior_external" | "senior_internal" | "junior" | "unknown";

export type AiPolishCultureRelationshipStage =
  | "new" | "established" | "long_term" | "unknown";

export type AiPolishModifierDefinition = {
  id: AiPolishModifierId;
  label: string;
  intent: string;
  promptInfluence: string;
};

export type AiPolishModeDefinition = {
  id: AiPolishModeId;
  label: string;
  category: string;
  description: string;
  objective: string;
  modifierIds: AiPolishModifierId[];
  defaultModifierIds?: AiPolishModifierId[];
};

export type AiPolishCultureBroadRegionDefinition = {
  id: AiPolishCultureBroadRegionId;
  label: string;
  countries: { id: AiPolishCultureCountryId; label: string }[];
};

export const AI_POLISH_CATEGORY = "Polish";

export const AI_POLISH_MODIFIERS: Record<AiPolishModifierId, AiPolishModifierDefinition> = {
  shorter: {
    id: "shorter",
    label: "Shorter",
    intent: "Reduce overall length — cut sentences, not just words.",
    promptInfluence: "Remove entire sentences, clauses, or sections that are not essential. Prioritize cutting over rephrasing. The output should be meaningfully shorter in sentence count, not just word count."
  },
  concise: {
    id: "concise",
    label: "More concise",
    intent: "Tighten the wording — say the same thing in fewer words.",
    promptInfluence: "Compress phrasing, eliminate filler words and redundant clauses, and reduce over-explanation. Keep all sentences but make each one leaner. Do not cut whole ideas — tighten how they are expressed."
  },
  detailed: {
    id: "detailed",
    label: "More detailed",
    intent: "Give the presentation a little more completeness.",
    promptInfluence: "Expand lightly where clarity or structure benefits from a little more detail."
  },
  softer: {
    id: "softer",
    label: "Softer tone",
    intent: "Reduce sharpness without changing the point.",
    promptInfluence: "Soften presentation and transitions while preserving intent and substance."
  },
  stronger: {
    id: "stronger",
    label: "Stronger tone",
    intent: "Make the message sound firmer and more assured.",
    promptInfluence: "Increase confidence and directness without adding new asks or claims."
  },
  structure: {
    id: "structure",
    label: "Add structure",
    intent: "Improve organization and readability.",
    promptInfluence: "Use cleaner sequencing, paragraphing, and structure so the message reads more clearly."
  },
  less_direct: {
    id: "less_direct",
    label: "Less direct",
    intent: "Soften directness for cultures where bluntness reads as rude.",
    promptInfluence: "Reduce blunt or abrupt phrasing. Add context and cushioning before key points. Avoid commands or stark refusals."
  },
  more_direct: {
    id: "more_direct",
    label: "More direct",
    intent: "Increase directness for cultures where indirectness reads as evasive.",
    promptInfluence: "Lead with the main point. Remove excessive preamble or indirect framing that obscures the ask."
  },
  increase_formality: {
    id: "increase_formality",
    label: "Increase formality",
    intent: "Raise courtesy markers for high-hierarchy or high-formality contexts.",
    promptInfluence: "Add appropriate titles, formal greetings, and deference signals. Use complete sentences and avoid casual phrasing."
  },
  relationship_opening: {
    id: "relationship_opening",
    label: "Relationship opening",
    intent: "Add a relational warm-up before the business point.",
    promptInfluence: "Open with a brief acknowledgment of the relationship or goodwill before the business purpose. Keep it genuine and brief."
  },
  face_preserving: {
    id: "face_preserving",
    label: "Face-preserving",
    intent: "Reframe declines or criticism to avoid causing the recipient to lose face.",
    promptInfluence: "Reframe refusals or critical points so they are indirect enough to preserve the recipient's dignity. Avoid language that implies fault or public failure."
  }
};

export const AI_POLISH_CULTURE_BROAD_REGIONS: AiPolishCultureBroadRegionDefinition[] = [
  { id: "global", label: "Global business-safe", countries: [] },
  { id: "east_asia", label: "East Asia", countries: [
    { id: "jp", label: "Japan" }, { id: "cn", label: "China" },
    { id: "kr", label: "South Korea" }, { id: "tw", label: "Taiwan" }
  ]},
  { id: "south_asia", label: "South Asia", countries: [
    { id: "in", label: "India" }, { id: "pk", label: "Pakistan" },
    { id: "bd", label: "Bangladesh" }, { id: "lk", label: "Sri Lanka" }
  ]},
  { id: "mena", label: "Middle East & North Africa", countries: [
    { id: "sa", label: "Saudi Arabia" }, { id: "ae", label: "UAE" },
    { id: "eg", label: "Egypt" }, { id: "tr", label: "Turkey" }
  ]},
  { id: "western_europe", label: "Western Europe", countries: [
    { id: "de", label: "Germany" }, { id: "fr", label: "France" },
    { id: "it", label: "Italy" }, { id: "es", label: "Spain" },
    { id: "nl", label: "Netherlands" }
  ]},
  { id: "northern_europe", label: "Northern Europe", countries: [
    { id: "se", label: "Sweden" }, { id: "no", label: "Norway" },
    { id: "dk", label: "Denmark" }, { id: "fi", label: "Finland" }
  ]},
  { id: "north_america", label: "North America & Anglophone", countries: [
    { id: "us", label: "United States" }, { id: "ca", label: "Canada" },
    { id: "gb", label: "United Kingdom" }, { id: "au", label: "Australia" }
  ]},
  { id: "latin_america", label: "Latin America", countries: [
    { id: "br", label: "Brazil" }, { id: "mx", label: "Mexico" },
    { id: "ar", label: "Argentina" }, { id: "co", label: "Colombia" }
  ]},
  { id: "ssa", label: "Sub-Saharan Africa", countries: [
    { id: "ng", label: "Nigeria" }, { id: "za", label: "South Africa" },
    { id: "ke", label: "Kenya" }, { id: "gh", label: "Ghana" }
  ]}
];

// Flat alias for any code still referencing AI_POLISH_CULTURE_REGIONS
export const AI_POLISH_CULTURE_REGIONS = AI_POLISH_CULTURE_BROAD_REGIONS.map(r => ({
  id: r.id, label: r.label
}));

export const AI_POLISH_CULTURE_SENIORITY_LABELS: Record<AiPolishCultureRecipientSeniority, string> = {
  peer: "Peer",
  senior_external: "Senior — external contact",
  senior_internal: "Senior — internal",
  junior: "Junior",
  unknown: "Not specified"
};

export const AI_POLISH_CULTURE_RELATIONSHIP_LABELS: Record<AiPolishCultureRelationshipStage, string> = {
  new: "New relationship",
  established: "Established",
  long_term: "Long-term",
  unknown: "Not specified"
};

export const AI_POLISH_MODES: AiPolishModeDefinition[] = [
  {
    id: "clean",
    label: "Clean & Clear",
    category: AI_POLISH_CATEGORY,
    description: "Sharpen clarity, flow, and structure without changing your register or tone.",
    objective: "Present the same message with tighter wording, less redundancy, better readability, and cleaner structure. Do not shift the tone warmer, cooler, more formal, or more casual — only improve how clearly it reads.",
    modifierIds: ["shorter", "concise", "detailed", "structure"],
    defaultModifierIds: ["concise", "structure"]
  },
  {
    id: "formal",
    label: "Formal",
    category: AI_POLISH_CATEGORY,
    description: "Raise the formality and courtesy of the message while preserving the content.",
    objective: "Present the same message in a more formal, structured, and traditionally professional register. Increase courtesy markers, tighten sentence construction, and use more considered vocabulary. Do not make the message warmer or more casual.",
    modifierIds: ["shorter", "concise", "detailed", "stronger", "structure"],
    defaultModifierIds: []
  },
  {
    id: "relaxed",
    label: "Relaxed",
    category: AI_POLISH_CATEGORY,
    description: "Make it sound like you actually wrote it — natural, readable, and competent without being stiff.",
    objective: "Reduce formality and stiffness while keeping the message credible and clear. Use more natural phrasing, shorter constructions, and conversational flow. Do not make it informal to the point of sounding unprofessional.",
    modifierIds: ["shorter", "concise", "detailed", "softer"],
    defaultModifierIds: []
  },
  {
    id: "warm",
    label: "Warm",
    category: AI_POLISH_CATEGORY,
    description: "Make it feel genuinely personal — like it came from someone who actually cares.",
    objective: "Add interpersonal warmth and human presence without making the message gushing, informal, or unprofessional. This is not about reducing formality — it is about adding relational presence. Keep the substance fully intact.",
    modifierIds: ["shorter", "concise", "softer"],
    defaultModifierIds: ["softer"]
  },
  {
    id: "trim",
    label: "Trim",
    category: AI_POLISH_CATEGORY,
    description: "Cut it down. Same message, same tone, just shorter.",
    objective: "Reduce length by removing redundancy, filler, unnecessary preamble, and over-explanation. Do not change tone, register, or substance. Do not rewrite for clarity or style — only cut what is not needed. Every sentence that remains should be earning its place.",
    modifierIds: ["structure"],
    defaultModifierIds: []
  },
  {
    id: "culture",
    label: "Culture",
    category: AI_POLISH_CATEGORY,
    description: "Adjust your message for how business communication actually works in your recipient's context.",
    objective: "Adapt the message's framing, directness, formality, courtesy signals, and relational structure for the selected region and recipient context. Preserve the full meaning and intent. Return the adjusted email alongside a brief set of cultural adjustment notes explaining what was changed and why.",
    modifierIds: ["less_direct", "more_direct", "increase_formality", "relationship_opening", "face_preserving"],
    defaultModifierIds: []
  },
  {
    id: "academic",
    label: "Academic",
    category: AI_POLISH_CATEGORY,
    description: "Improve logical structure, precision, and formal reasoning in academic or research writing.",
    objective: "Sharpen the message for an academic or research context: improve argument structure, tighten logical transitions, use objective and precise language, and ensure claims are clearly grounded. Preserve all nuance, hedging, and complexity — do not oversimplify. Do not make the writing warmer or more conversational.",
    modifierIds: ["concise", "detailed", "structure"],
    defaultModifierIds: ["structure"]
  }
];

export function getAiPolishModeDefinition(modeId: string) {
  return AI_POLISH_MODES.find((mode) => mode.id === modeId) ?? null;
}

export function getAiPolishModifierDefinitionsForMode(modeId: AiPolishModeId) {
  const mode = getAiPolishModeDefinition(modeId);
  if (!mode) {
    return [];
  }

  return mode.modifierIds.map((modifierId) => AI_POLISH_MODIFIERS[modifierId]);
}

export function getAiPolishDefaultModifiersForMode(modeId: AiPolishModeId) {
  const mode = getAiPolishModeDefinition(modeId);
  if (!mode?.defaultModifierIds?.length) {
    return [] as AiPolishModifierId[];
  }
  return [...mode.defaultModifierIds];
}

export function areAiPolishModifiersValid(modeId: AiPolishModeId, modifierIds: string[]) {
  const allowedIds = new Set(getAiPolishModifierDefinitionsForMode(modeId).map((item) => item.id));
  return modifierIds.every((modifierId) => allowedIds.has(modifierId as AiPolishModifierId));
}
