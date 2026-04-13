import { getCurrentOwnerOpenAiCredential } from "@/lib/ai-settings";
import type { QuickFactConfidence, QuickFactResult } from "@/lib/quickfact";
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
  return `
You are cleaning up a fact-retrieval result for an email-writing tool.

Answer the user's question as directly as possible.
Use only the provided retrieval evidence.
Return 1 to 2 short sentences maximum.
If evidence is weak, conflicting, or does not directly answer the query, return empty answer.
Do not add filler, commentary, or conversational framing.
Do not say "according to various sources."
Do not include raw snippets or page junk.
Prefer exact dates, counts, names, models, and short factual clarifications.

User query:
${input.query}

Query type:
${input.queryType}

Retrieval confidence:
${input.retrievalConfidence}

Retrieved evidence:
${buildEvidenceBlock(input.bundle)}
`.trim();
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
  sourceIndex: number | null
): QuickFactResult | null {
  const compactAnswer = compactText(stripNoise(answer));
  if (!compactAnswer) {
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

  const parsed = parseCompletion(content);
  const confidence = clampConfidence(
    parsed.confidence,
    input.retrievalConfidence,
    input.retrievalConfidence !== "strong"
  );
  const result = buildResult(input.bundle, parsed.answer, confidence, parsed.sourceIndex);

  if (!result) {
    return [];
  }

  if (!seemsRelevantToQuery(result.answer, input.query)) {
    return [];
  }

  return [result];
}
