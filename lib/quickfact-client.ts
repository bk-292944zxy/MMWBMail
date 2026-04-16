import type { QuickFactRequest, QuickFactResponse } from "@/lib/quickfact";

export async function fetchQuickFacts(input: QuickFactRequest): Promise<QuickFactResponse> {
  const response = await fetch("/api/quickfact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: input.query,
      ...(input.draftContext ? { draftContext: input.draftContext } : {})
    })
  });

  const payload = (await response.json().catch(() => ({ results: [] }))) as QuickFactResponse & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load QuickFact results.");
  }

  return {
    results: Array.isArray(payload.results) ? payload.results : [],
    fallback: payload.fallback
  };
}
