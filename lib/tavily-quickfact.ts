import { getCurrentOwnerTavilyApiKey } from "@/lib/tavily-settings";
import type {
  QuickFactConfidence,
  QuickFactFallback,
  QuickFactResult
} from "@/lib/quickfact";

export type QuickFactQueryType =
  | "date"
  | "count"
  | "product"
  | "market_fact"
  | "role_or_name"
  | "general_fact";

export type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
  publishedDate?: string;
};

type TavilySearchResponse = {
  answer?: string;
  results?: TavilySearchResult[];
};

export type QuickFactRetrievalQuality = "strong" | "mixed" | "weak" | "empty";

export type TavilyQuickFactBundle = {
  query: string;
  normalizedQuery: string;
  queryType: QuickFactQueryType;
  answer: string | null;
  rawResults: TavilySearchResult[];
  cleanResults: QuickFactResult[];
  bestSource: TavilySearchResult | null;
  retrievalQuality: QuickFactRetrievalQuality;
  fallback?: QuickFactFallback;
};

const QUICKFACT_RESULT_LIMIT = 1;
const QUICKFACT_MAX_RESULTS = 4;
const QUICKFACT_EXCLUDED_DOMAINS = [
  "reddit.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "stackexchange.com"
];
const HIGH_TRUST_DOMAIN_HINTS = [
  ".gov",
  ".edu",
  "wikipedia.org",
  "britannica.com",
  "github.com",
  "google.com",
  "apple.com",
  "amazon.com",
  "microsoft.com",
  "salesforce.com",
  "academyawards.com",
  "oscars.org"
];
const REPUTABLE_DOMAIN_HINTS = [
  "apnews.com",
  "reuters.com",
  "nytimes.com",
  "wsj.com",
  "bloomberg.com",
  "forbes.com",
  "investopedia.com",
  "sec.gov"
];
const TITLE_REJECTION_PATTERNS = [
  /\breddit\b/i,
  /\bquora\b/i,
  /\bforum\b/i,
  /\bdiscussion\b/i,
  /\bcommunity\b/i,
  /\bthread\b/i,
  /\bopinion\b/i,
  /\blist of\b/i,
  /\btop\s+\d+\b/i,
  /\bbest\b/i
];
const URL_REJECTION_PATTERNS = [
  /\/forum\//i,
  /\/forums\//i,
  /\/community\//i,
  /\/discussion\//i,
  /\/thread\//i,
  /\/comments\//i,
  /\/questions\//i
];
const FACT_SIGNAL_PATTERNS = [
  /\b\d{4}\b/,
  /\b\d+(?:,\d{3})*(?:\.\d+)?\b/,
  /\b\d+(?:\.\d+)?%\b/,
  /\bwas\b/i,
  /\bis\b/i,
  /\bare\b/i,
  /\bhas\b/i,
  /\bhad\b/i,
  /\breleased\b/i,
  /\bfounded\b/i,
  /\bmerged\b/i,
  /\bnewest\b/i,
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\bmodel\b/i,
  /\blineup\b/i,
  /\bwent public\b/i,
  /\bipo\b/i,
  /\bsold\b/i,
  /\bemployees?\b/i
];
const QUICKFACT_NOISE_PATTERNS = [
  /live countdown/i,
  /share (it|this) with your friends/i,
  /click here/i,
  /learn more/i,
  /read more/i,
  /watch now/i,
  /sign up/i,
  /subscribe/i,
  /breaking news/i,
  /comments?/i,
  /votes?/i,
  /hours?, minutes?(?:,| and) seconds?/i,
  /follow us/i,
  /download now/i,
  /newsletter/i
];

const QUICKFACT_TAVILY_TIMEOUT_MS = 7000;

function normalizeQuickFactQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractSourceName(result: TavilySearchResult) {
  const domain = extractDomain(result.url ?? "");
  if (domain) {
    return domain.replace(/^www\./, "");
  }

  return result.title?.trim() || "Source";
}

function isExcludedDomain(domain: string) {
  return QUICKFACT_EXCLUDED_DOMAINS.some(
    (excluded) => domain === excluded || domain.endsWith(`.${excluded}`)
  );
}

function isHighTrustDomain(domain: string) {
  return HIGH_TRUST_DOMAIN_HINTS.some(
    (hint) => domain === hint || domain.endsWith(`.${hint}`) || domain.endsWith(hint)
  );
}

function isReputableDomain(domain: string) {
  return REPUTABLE_DOMAIN_HINTS.some(
    (hint) => domain === hint || domain.endsWith(`.${hint}`) || domain.endsWith(hint)
  );
}

function toCompactAnswer(text: string) {
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

function splitSentences(text: string) {
  return (text.match(/[^.!?]+[.!?]?/g) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function classifyQuickFactQuery(query: string): QuickFactQueryType {
  const normalized = query.toLowerCase();

  if (/\bwhen\b|\bwhat year\b|\bdate\b|\breleased\b|\bfounded\b|\bmerged\b|\bgo public\b/.test(normalized)) {
    return "date";
  }

  if (/\bhow many\b|\bnumber of\b|\bcount\b|\bpopulation\b/.test(normalized)) {
    return /\bsold\b|\bsales\b|\brevenue\b|\bmarket\b/.test(normalized) ? "market_fact" : "count";
  }

  if (/\bnewest\b|\blatest\b|\bcurrent\b|\bmodel\b|\bversion\b|\blineup\b/.test(normalized)) {
    return "product";
  }

  if (/\bsold\b|\bsales\b|\brevenue\b|\bmarket\b|\bshare\b|\branking\b|\brand\b/.test(normalized)) {
    return "market_fact";
  }

  if (/\bwho is\b|\bwhat is\b|\btitle\b|\brole\b|\bdefinition\b|\bcalled\b|\bname of\b/.test(normalized)) {
    return "role_or_name";
  }

  return "general_fact";
}

function looksTooBroadForQuickFact(query: string) {
  const normalized = query.toLowerCase();
  return (
    normalized.length > 120 ||
    /\bcompare\b|\banalyze\b|\bpros and cons\b|\bwhy\b|\bstrategy\b|\bresearch\b|\bdeep dive\b|\bforecast\b/.test(
      normalized
    )
  );
}

function looksLikeWeakResult(result: TavilySearchResult) {
  const title = result.title?.trim() ?? "";
  const url = result.url?.trim() ?? "";
  return (
    TITLE_REJECTION_PATTERNS.some((pattern) => pattern.test(title)) ||
    URL_REJECTION_PATTERNS.some((pattern) => pattern.test(url))
  );
}

function hasFactLikeAnswer(text: string) {
  return FACT_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function stripNoisePhrases(text: string) {
  let next = text;
  QUICKFACT_NOISE_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, "");
  });

  return next.replace(/\s+/g, " ").trim();
}

function normalizeSubjectFromQuery(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/\bhow many\b/g, "")
    .replace(/\bwhat year\b/g, "")
    .replace(/\bwhen was\b/g, "")
    .replace(/\bwhen did\b/g, "")
    .replace(/\bwhat is\b/g, "")
    .replace(/\bwhat are\b/g, "")
    .replace(/\bwho is\b/g, "")
    .replace(/\bnewest\b/g, "")
    .replace(/\blatest\b/g, "")
    .replace(/\bcurrent\b/g, "")
    .replace(/\bmodel\b/g, "")
    .replace(/\bversion\b/g, "")
    .replace(/\bthis year\b/g, "")
    .replace(/\blast year\b/g, "")
    .replace(/\byears?\b/g, "")
    .replace(/\bdid\b/g, "")
    .replace(/\bdoes\b/g, "")
    .replace(/\bdo\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "That";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatQueryAwareAnswer(
  queryType: QuickFactQueryType,
  query: string,
  text: string
) {
  const subject = normalizeSubjectFromQuery(query);
  const sentences = splitSentences(text);
  const firstSentence = sentences[0] ?? text;

  if (queryType === "count" || queryType === "market_fact" || /\bhow many\b/i.test(query)) {
    const countMatch = firstSentence.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/);
    if (countMatch) {
      return `${subject} is ${countMatch[0]}.`;
    }
  }

  if (queryType === "date") {
    const dateMatch =
      firstSentence.match(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i
      ) ?? firstSentence.match(/\b\d{4}\b/);
    if (dateMatch) {
      return `${subject} was ${dateMatch[0]}.`;
    }
  }

  if (queryType === "product") {
    return toCompactAnswer(firstSentence);
  }

  return toCompactAnswer(sentences.slice(0, 2).join(" "));
}

function normalizeQuickFactAnswer(
  raw: string,
  query: string,
  queryType: QuickFactQueryType
) {
  const cleaned = stripNoisePhrases(raw);
  if (!cleaned) {
    return "";
  }

  const factSentences = splitSentences(cleaned).filter(
    (sentence) =>
      !QUICKFACT_NOISE_PATTERNS.some((pattern) => pattern.test(sentence)) &&
      (hasFactLikeAnswer(sentence) ||
        queryType === "product" ||
        queryType === "role_or_name" ||
        queryType === "general_fact")
  );

  const candidate = factSentences.slice(0, 2).join(" ").trim();
  if (!candidate) {
    return "";
  }

  return formatQueryAwareAnswer(queryType, query, candidate).trim();
}

function scoreSource(result: TavilySearchResult) {
  const domain = extractDomain(result.url ?? "");
  if (!domain || isExcludedDomain(domain) || looksLikeWeakResult(result)) {
    return -1;
  }

  const highTrustBoost = isHighTrustDomain(domain) ? 0.45 : 0;
  const reputableBoost = !highTrustBoost && isReputableDomain(domain) ? 0.22 : 0;
  return (result.score ?? 0) + highTrustBoost + reputableBoost;
}

function inferConfidence(result: TavilySearchResult): QuickFactConfidence {
  const domain = extractDomain(result.url ?? "");
  if (isHighTrustDomain(domain)) {
    return "high";
  }

  if (isReputableDomain(domain) || (result.score ?? 0) >= 0.72) {
    return "high";
  }

  if ((result.score ?? 0) >= 0.45) {
    return "medium";
  }

  return "low";
}

function normalizeResult(
  result: TavilySearchResult,
  query: string,
  queryType: QuickFactQueryType,
  fallbackAnswer?: string
): QuickFactResult | null {
  const sourceUrl = result.url?.trim() ?? "";
  if (!sourceUrl) {
    return null;
  }

  const domain = extractDomain(sourceUrl);
  if (!domain || isExcludedDomain(domain) || looksLikeWeakResult(result)) {
    return null;
  }

  const answer = normalizeQuickFactAnswer(result.content || fallbackAnswer || "", query, queryType);
  if (!answer || !hasFactLikeAnswer(answer)) {
    return null;
  }

  return {
    answer,
    sourceName: extractSourceName(result),
    sourceUrl,
    sourceDate: result.published_date || result.publishedDate || undefined,
    confidence: inferConfidence(result)
  };
}

export function buildQuickFactFallback(reason: QuickFactFallback["reason"]): QuickFactFallback {
  switch (reason) {
    case "too_broad":
      return {
        reason,
        message: "This looks better suited for a broader search.",
        actionLabel: "Search more broadly"
      };
    case "backend_error":
    case "timeout":
    case "no_clean_fact":
    default:
      return {
        reason,
        message: "I couldn't find a clean quick fact for that.",
        actionLabel: "Search more broadly"
      };
  }
}

async function runTavilySearch(query: string, queryType: QuickFactQueryType, fallbackPass = false) {
  const apiKey = await getCurrentOwnerTavilyApiKey();
  const maxResults = fallbackPass ? 6 : QUICKFACT_MAX_RESULTS;
  const searchDepth =
    fallbackPass && (queryType === "product" || queryType === "market_fact" || queryType === "general_fact")
      ? "advanced"
      : "basic";

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), QUICKFACT_TAVILY_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: "basic",
        include_raw_content: false,
        include_images: false,
        exclude_domains: QUICKFACT_EXCLUDED_DOMAINS
      }),
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("QuickFact provider request failed.");
    }

    return (await response.json().catch(() => null)) as TavilySearchResponse | null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function rankResults(payload: TavilySearchResponse | null) {
  return (payload?.results ?? [])
    .filter((result) => {
      const domain = extractDomain(result.url ?? "");
      return Boolean(result.url) && Boolean(domain) && !isExcludedDomain(domain);
    })
    .sort((left, right) => scoreSource(right) - scoreSource(left));
}

function chooseBestSource(results: TavilySearchResult[]) {
  return results.find((result) => scoreSource(result) >= 0) ?? null;
}

function determineRetrievalQuality(bundle: {
  rawResults: TavilySearchResult[];
  cleanResults: QuickFactResult[];
  answer: string | null;
}): QuickFactRetrievalQuality {
  const hasAnswerEvidence = Boolean(bundle.answer?.trim());

  if (bundle.rawResults.length === 0 && !hasAnswerEvidence) {
    return "empty";
  }

  if (bundle.cleanResults.length === 0) {
    return hasAnswerEvidence ? "weak" : "empty";
  }

  const topClean = bundle.cleanResults[0];
  const topRaw = bundle.rawResults[0];
  const strongAnswer = Boolean(bundle.answer?.trim()) || topClean.answer.length <= 140;
  const strongSource = topRaw ? scoreSource(topRaw) >= 0.7 && inferConfidence(topRaw) === "high" : false;

  if (strongAnswer && strongSource && topClean.confidence === "high") {
    return "strong";
  }

  return "mixed";
}

function extractFactsFromPayload(
  payload: TavilySearchResponse | null,
  query: string,
  queryType: QuickFactQueryType
) {
  const rankedResults = rankResults(payload);

  const facts: QuickFactResult[] = [];
  for (const result of rankedResults) {
    if (scoreSource(result) < 0) {
      continue;
    }

    const normalized = normalizeResult(result, query, queryType, payload?.answer);
    if (!normalized) {
      continue;
    }

    if (queryType === "count" && normalized.confidence === "low") {
      continue;
    }

    facts.push(normalized);
    if (facts.length >= QUICKFACT_RESULT_LIMIT) {
      break;
    }
  }

  return facts;
}

function toCleanAnswerFallback(
  cleanResults: QuickFactResult[],
  queryType: QuickFactQueryType,
  query: string
) {
  const first = cleanResults[0];
  if (!first) {
    return "";
  }

  if (queryType === "count" || queryType === "market_fact" || /\bhow many\b/i.test(query)) {
    const countMatch = first.answer.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/);
    if (countMatch) {
      return `${normalizeSubjectFromQuery(query)} is ${countMatch[0]}.`;
    }
  }

  return first.answer;
}

export async function fetchTavilyQuickFactBundle(query: string): Promise<TavilyQuickFactBundle> {
  const normalizedQuery = normalizeQuickFactQuery(query);
  if (!normalizedQuery || looksTooBroadForQuickFact(normalizedQuery)) {
    return {
      query,
      normalizedQuery,
      queryType: classifyQuickFactQuery(normalizedQuery || query),
      answer: null,
      rawResults: [],
      cleanResults: [],
      bestSource: null,
      retrievalQuality: "empty",
      fallback: buildQuickFactFallback("too_broad")
    };
  }

  const queryType = classifyQuickFactQuery(normalizedQuery);
  const firstPayload = await runTavilySearch(normalizedQuery, queryType, false);
  let activePayload = firstPayload;
  let rawResults = rankResults(firstPayload);
  let cleanResults = extractFactsFromPayload(firstPayload, normalizedQuery, queryType);

  if (
    cleanResults.length === 0 &&
    (queryType === "product" || queryType === "market_fact" || queryType === "general_fact")
  ) {
    const secondPayload = await runTavilySearch(normalizedQuery, queryType, true);
    const secondRawResults = rankResults(secondPayload);
    const secondCleanResults = extractFactsFromPayload(secondPayload, normalizedQuery, queryType);

    rawResults = [...rawResults, ...secondRawResults].sort((left, right) => scoreSource(right) - scoreSource(left));
    cleanResults = secondCleanResults.length > 0 ? secondCleanResults : cleanResults;
    activePayload = secondPayload ?? firstPayload;
  }

  const bestSource = chooseBestSource(rawResults);
  const answer = toCleanAnswerFallback(cleanResults, queryType, normalizedQuery) || activePayload?.answer?.trim() || null;
  const retrievalQuality = determineRetrievalQuality({
    rawResults,
    cleanResults,
    answer
  });

  if (cleanResults.length === 0) {
    return {
      query,
      normalizedQuery,
      queryType,
      answer,
      rawResults,
      cleanResults,
      bestSource,
      retrievalQuality,
      fallback: buildQuickFactFallback("no_clean_fact")
    };
  }

  return {
    query,
    normalizedQuery,
    queryType,
    answer,
    rawResults,
    cleanResults,
    bestSource,
    retrievalQuality
  };
}
