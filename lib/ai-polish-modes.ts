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
  | "structure";

export type AiPolishModeId =
  | "clean"
  | "formal"
  | "relaxed"
  | "culture"
  | "professional"
  | "academic"
  ;

export type AiPolishCultureRegionId =
  | "global"
  | "western"
  | "east_asia"
  | "south_asia"
  | "mena"
  | "ssa"
  | "latin_america";

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
};

export type AiPolishCultureRegionDefinition = {
  id: AiPolishCultureRegionId;
  label: string;
};

export const AI_POLISH_CATEGORY = "Polish";

export const AI_POLISH_MODIFIERS: Record<AiPolishModifierId, AiPolishModifierDefinition> = {
  shorter: {
    id: "shorter",
    label: "Shorter",
    intent: "Trim length while keeping the same message.",
    promptInfluence: "Shorten wording and remove unnecessary filler without changing meaning."
  },
  concise: {
    id: "concise",
    label: "More concise",
    intent: "Make the message more efficient and direct.",
    promptInfluence: "Tighten phrasing, reduce repetition, and improve clarity."
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
  }
};

export const AI_POLISH_CULTURE_REGIONS: AiPolishCultureRegionDefinition[] = [
  { id: "global", label: "Global business-safe" },
  { id: "western", label: "Western" },
  { id: "east_asia", label: "East Asia" },
  { id: "south_asia", label: "South Asia" },
  { id: "mena", label: "Middle East & North Africa" },
  { id: "ssa", label: "Sub-Saharan Africa" },
  { id: "latin_america", label: "Latin America" }
];

export const AI_POLISH_MODES: AiPolishModeDefinition[] = [
  {
    id: "clean",
    label: "Clean",
    category: AI_POLISH_CATEGORY,
    description: "Improve clarity and flow without changing the substance.",
    objective: "Present the same message with cleaner wording, less redundancy, and better readability.",
    modifierIds: ["shorter", "concise", "detailed", "softer", "stronger", "structure"]
  },
  {
    id: "formal",
    label: "Formal",
    category: AI_POLISH_CATEGORY,
    description: "Increase formality and courtesy while preserving the message.",
    objective: "Present the same content in a more formal, structured, and traditionally professional register.",
    modifierIds: ["shorter", "concise", "detailed", "softer", "stronger", "structure"]
  },
  {
    id: "relaxed",
    label: "Relaxed",
    category: AI_POLISH_CATEGORY,
    description: "Make it feel more natural and conversational without losing competence.",
    objective: "Present the same message with a more relaxed, readable tone and less stiffness.",
    modifierIds: ["shorter", "concise", "detailed", "softer", "stronger", "structure"]
  },
  {
    id: "culture",
    label: "Culture",
    category: AI_POLISH_CATEGORY,
    description: "Adjust presentation for cross-cultural business communication.",
    objective: "Present the same message with region-aware courtesy, directness, and framing without changing meaning.",
    modifierIds: []
  },
  {
    id: "professional",
    label: "Professional",
    category: AI_POLISH_CATEGORY,
    description: "Use a modern business tone that is clear, direct, and easy to act on.",
    objective: "Present the same message with competent business polish and stronger action-readiness.",
    modifierIds: ["shorter", "concise", "detailed", "softer", "stronger", "structure"]
  },
  {
    id: "academic",
    label: "Academic",
    category: AI_POLISH_CATEGORY,
    description: "Improve logical flow, precision, and formal structure.",
    objective: "Present the same meaning with clearer reasoning, transitions, and objective tone.",
    modifierIds: ["shorter", "concise", "detailed", "softer", "stronger", "structure"]
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

export function areAiPolishModifiersValid(modeId: AiPolishModeId, modifierIds: string[]) {
  const allowedIds = new Set(getAiPolishModifierDefinitionsForMode(modeId).map((item) => item.id));
  return modifierIds.every((modifierId) => allowedIds.has(modifierId as AiPolishModifierId));
}
