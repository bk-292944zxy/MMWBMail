import { getCurrentOwnerOpenAiCredential } from "@/lib/ai-settings";
import type { QuickFactConfidence, QuickFactResult } from "@/lib/quickfact";
import { validateQuickFactAnswer } from "@/lib/tavily-quickfact";
import type {
  QuickFactQueryType,
  TavilyQuickFactBundle,
  TavilySearchResult
} from "@/lib/tavily-quickfact";

const QUICKFACT_OPENAI_MODEL = "gpt-4.1-mini";
const QUICKFACT_OPENAI_TIMEOUT_MS = 7000;

export type QuickFactCondenseInput = {
  query: string;
  queryType: QuickFactQueryType;
  retrievalConfidence: "strong" | "mixed" | "weak" | "empty";
  bundle: TavilyQuickFactBundle;
  draftContext?: string; // up to 150 chars of surrounding draft text
};
const CONDENSE_STOPWORDS = new Set([
  "a","an","the","of","in","on","at","to","for","with","and","or","by","from",
  "is","are","was","were","be","been","being","do","does","did","who","what",
  "when","where","why","how","much","many","often","last","latest","current"
]);

type QuickFactCondenseCompletion = {
  answer?: string;
  confidence?: QuickFactConfidence;
  sourceIndex?: number | null;
};

type QuickFactCondenseMessage = {
  role: "system" | "user";
  content: string;
};

function stringifySource(result: TavilySearchResult, index: number) {
  return JSON.stringify({
    index,
    name: result.title?.trim() || null,
    url: result.url?.trim() || null,
    date: result.published_date || result.publishedDate || null,
    score: typeof result.score === "number" ? Number(result.score.toFixed(3)) : null,
    snippet: result.content?.trim() || null
  });
}

function compactText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .trim();
}

function stripNoise(text: string) {
  return text
    .replace(/\baccording to various sources,?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourceDisplayName(result: TavilySearchResult) {
  try {
    const domain = result.url ? new URL(result.url).hostname.replace(/^www\./, "") : "";
    return domain || result.title?.trim() || undefined;
  } catch {
    return result.title?.trim() || undefined;
  }
}

function buildEvidenceBlock(bundle: TavilyQuickFactBundle) {
  const lines: string[] = [];

  lines.push(`Retrieval confidence: ${bundle.retrievalQuality}`);
  lines.push(`Tavily answer: ${bundle.answer?.trim() || "(none)"}`);

  if (bundle.cleanResults.length > 0) {
    lines.push("Clean candidates:");
    bundle.cleanResults.forEach((result, index) => {
      lines.push(
        `${index + 1}. ${JSON.stringify({
          answer: result.answer,
          sourceName: result.sourceName ?? null,
          sourceUrl: result.sourceUrl ?? null,
          sourceDate: result.sourceDate ?? null,
          confidence: result.confidence ?? null
        })}`
      );
    });
  }

  if (bundle.rawResults.length > 0) {
    lines.push("Retrieved sources:");
    bundle.rawResults.slice(0, 4).forEach((result, index) => {
      lines.push(`${index + 1}. ${stringifySource(result, index + 1)}`);
    });
  }

  return lines.join("\n");
}

export function buildQuickFactCondensePrompt(input: QuickFactCondenseInput) {
  const formatGuide: Record<string, string> = {
    date: "Return a compact date or event phrase — e.g. 'April 1, 1976' or 'founded April 1, 1976'. No full sentence needed.",
    count: "Return a compact numeric fact — e.g. '3.2 million units (2024)' or '~4,200 employees'. Include unit and time scope.",
    market_fact: "Return a compact stat or figure — e.g. '34.2% market share (Q3 2024, IDC)'. Include unit, scope, and source hint if available.",
    product: "Return a compact product name and context — e.g. 'the iPhone 16 Pro (released September 2024)'. No sentence framing needed.",
    role_or_name: "Return a compact identity phrase — e.g. 'Sundar Pichai (CEO, Google as of 2024)'. Include role and org if relevant.",
    general_fact: "Return one tight factual sentence. End with a period. No preamble, no commentary."
  };

  const outputFormat = formatGuide[input.queryType] ?? formatGuide.general_fact;
  const contextLine = input.draftContext?.trim()
    ? `Surrounding draft text (match tense and subject conventions where natural):\n"${input.draftContext.trim()}"`
    : null;

  return [
    "You are extracting a clean, insertable fact for an email-writing tool.",
    "",
    "Rules:",
    "- Answer the query using only the retrieved evidence below.",
    "- Output format for this query type: " + outputFormat,
    "- Do not write a full declarative sentence unless query type is general_fact.",
    "- Do not include subject if it can be inferred from the surrounding draft text.",
    "- Match the grammatical tense of the surrounding draft text where natural.",
    "- Do not add filler, commentary, or conversational framing.",
    "- Do not say 'according to various sources' or similar.",
    "- Do not include raw snippet text or page junk.",
    "- Preserve exact numbers, units, dates, names, and scope — never round or estimate.",
    "- Never guess missing numbers, years, winners, percentages, or prices.",
    "- If evidence does not support a clean answer, return empty answer.",
    "",
    contextLine,
    "",
    `User query: ${input.query}`,
    `Query type: ${input.queryType}`,
    `Retrieval confidence: ${input.retrievalConfidence}`,
    "",
    "Retrieved evidence:",
    buildEvidenceBlock(input.bundle)
  ].filter(line => line !== null).join("\n").trim();
}

function extractKeywords(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s$%.-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !CONDENSE_STOPWORDS.has(token));
}

function seemsRelevantToQuery(answer: string, query: string) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return answer.trim().length > 0;
  }

  const normalized = answer.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function parseCompletion(content: string) {
  try {
    const parsed = JSON.parse(content) as QuickFactCondenseCompletion;
    const confidence =
      parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
        ? parsed.confidence
        : undefined;

    return {
      answer: typeof parsed.answer === "string" ? parsed.answer.trim() : "",
      confidence,
      sourceIndex:
        typeof parsed.sourceIndex === "number" && Number.isFinite(parsed.sourceIndex)
          ? Math.trunc(parsed.sourceIndex)
          : null
    };
  } catch {
    return {
      answer: content.trim(),
      confidence: undefined,
      sourceIndex: null
    };
  }
}

function clampConfidence(
  modelConfidence: QuickFactConfidence | undefined,
  retrievalConfidence: QuickFactCondenseInput["retrievalConfidence"],
  usedFallback: boolean
): QuickFactConfidence {
  if (retrievalConfidence === "weak" || retrievalConfidence === "empty") {
    return "low";
  }

  if (modelConfidence === "high" && retrievalConfidence === "strong") {
    return usedFallback ? "medium" : "high";
  }

  if (modelConfidence === "low") {
    return "low";
  }

  return "medium";
}

function resolveSource(bundle: TavilyQuickFactBundle, sourceIndex: number | null) {
  if (
    sourceIndex &&
    sourceIndex > 0 &&
    sourceIndex <= bundle.rawResults.length
  ) {
    return bundle.rawResults[sourceIndex - 1];
  }

  return bundle.bestSource;
}

function buildResult(
  bundle: TavilyQuickFactBundle,
  answer: string,
  confidence: QuickFactConfidence,
  sourceIndex: number | null,
  query: string,
  queryType: QuickFactQueryType
): QuickFactResult | null {
  const stripped = stripNoise(answer);
  // Only run sentence-splitting compaction on general_fact answers.
  // Phrase-form answers for other query types should be preserved as-is
  // after noise stripping — splitting on punctuation destroys them.
  const compactAnswer = queryType === "general_fact"
    ? compactText(stripped)
    : stripped.trim();
  if (!compactAnswer) {
    return null;
  }

  const validation = validateQuickFactAnswer(compactAnswer, query, queryType);
  if (!validation.acceptable) {
    return null;
  }

  const source = resolveSource(bundle, sourceIndex);
  const result: QuickFactResult = {
    answer: compactAnswer,
    confidence
  };

  if (source) {
    result.sourceName = extractSourceDisplayName(source);
    result.sourceUrl = source.url?.trim() || undefined;
    result.sourceDate = source.published_date || source.publishedDate || undefined;
  }

  return result;
}

async function callOpenAi(messages: QuickFactCondenseMessage[]) {
  const credential = await getCurrentOwnerOpenAiCredential();
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), QUICKFACT_OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`
      },
      body: JSON.stringify({
        model: QUICKFACT_OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages
      }),
      cache: "no-store",
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          choices?: Array<{
            message?: {
              content?: string | null;
            };
          }>;
          error?: {
            message?: string;
          };
        }
      | null;

    if (!response.ok) {
      throw new Error(
        payload?.error?.message?.trim() || "OpenAI couldn't complete that quick fact request."
      );
    }

    return payload?.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function condenseQuickFactWithGPT(
  input: QuickFactCondenseInput
): Promise<QuickFactResult[]> {
  if (
    input.retrievalConfidence === "empty" ||
    (input.retrievalConfidence === "weak" && input.bundle.cleanResults.length === 0)
  ) {
    return [];
  }

  let content = "";

  try {
    content = await callOpenAi([
      {
        role: "system",
        content:
          "You rewrite fact retrieval into a compact, source-aware answer. Return JSON with keys answer, confidence, and sourceIndex."
      },
      {
        role: "user",
        content: buildQuickFactCondensePrompt(input)
      }
    ]);
  } catch {
    return [];
  }

  if (!content) {
    return [];
  }

  const evaluationQuery = input.bundle.normalizedQuery || input.query;
  const parsed = parseCompletion(content);
  const confidence = clampConfidence(
    parsed.confidence,
    input.retrievalConfidence,
    input.retrievalConfidence !== "strong"
  );
  const result = buildResult(
    input.bundle,
    parsed.answer,
    confidence,
    parsed.sourceIndex,
    evaluationQuery,
    input.queryType
  );

  if (!result) {
    return [];
  }

  if (!seemsRelevantToQuery(result.answer, evaluationQuery)) {
    return [];
  }

  return [result];
}
