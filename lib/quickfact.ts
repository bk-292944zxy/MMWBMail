export type QuickFactRequest = {
  query: string;
  draftContext?: string; // max 150 chars, optional
};

export type QuickFactConfidence = "high" | "medium" | "low";

export type QuickFactFallbackReason =
  | "no_clean_fact"
  | "too_broad"
  | "timeout"
  | "backend_error";

export type QuickFactResult = {
  answer: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceDate?: string;
  confidence?: QuickFactConfidence;
};

export type QuickFactFallback = {
  reason: QuickFactFallbackReason;
  message: string;
  actionLabel?: string;
};

export type QuickFactResponse = {
  results: QuickFactResult[];
  fallback?: QuickFactFallback;
};

export function formatQuickFactForInsert(
  result: QuickFactResult,
  options?: { includeSource?: boolean }
) {
  const answer = result.answer.trim();
  if (!options?.includeSource) {
    return answer;
  }

  const sourceName = result.sourceName?.trim() ?? "";
  if (!sourceName) {
    return answer;
  }

  return `${answer} (Source: ${sourceName})`;
}
