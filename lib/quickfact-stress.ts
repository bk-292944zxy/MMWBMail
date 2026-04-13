import {
  evaluateQuickFactStressCase,
  normalizeQuickFactQuery
} from "@/lib/tavily-quickfact";
import type {
  QuickFactStressEvaluation,
  TavilySearchResult
} from "@/lib/tavily-quickfact";

export type QuickFactStressCaseResult = {
  id: string;
  query: string;
  pass: boolean;
  failures: string[];
  evaluation: QuickFactStressEvaluation;
};

type QuickFactStressCase = {
  id: string;
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  checks: Array<(evaluation: QuickFactStressEvaluation) => string | null>;
};

const LAST_YEAR = new Date().getFullYear() - 1;
const PRICE_AND_PACK_PATTERN =
  /(?:\$|\busd\b).*(?:\b4[- ]?(?:pack|count|ct)\b)|(?:\b4[- ]?(?:pack|count|ct)\b).*(?:\$|\busd\b)/i;

function firstAnswer(evaluation: QuickFactStressEvaluation) {
  return evaluation.cleanResults[0]?.answer ?? "";
}

const QUICKFACT_STRESS_CASES: QuickFactStressCase[] = [
  {
    id: "winner_directness",
    query: "who won the last american idol season",
    results: [
      {
        title: "American Idol season 22 winner announced",
        url: "https://abc.com/american-idol/finale",
        content: "Abi Carter won American Idol season 22 in May 2024.",
        score: 0.88
      },
      {
        title: "Encyclopaedia Britannica contributor profile",
        url: "https://www.britannica.com/biography/someone",
        content: "By the Editors of Encyclopaedia Britannica. Contributor biography and article list.",
        score: 0.76
      }
    ],
    checks: [
      (evaluation) =>
        firstAnswer(evaluation).includes("Abi Carter") ? null : "Expected direct winner identity in top answer.",
      (evaluation) =>
        /\b(2024|season 22)\b/i.test(firstAnswer(evaluation))
          ? null
          : "Expected time or season context for most-recent winner query."
    ]
  },
  {
    id: "nationwide_sales_scope_guard",
    query: "how many new cameros sold last year nationwide",
    results: [
      {
        title: "Camaro regional dashboard",
        url: "https://example-motors.com/reports/q1-camaro",
        content: "Chevrolet Camaro sales were 1,044 units in Q1 2025 in one regional dashboard.",
        score: 0.82
      },
      {
        title: "GM annual U.S. sales report",
        url: "https://www.gm.com/investors/sales/2025-us",
        content: "General Motors reported 5,336 Chevrolet Camaro units sold in the United States in 2025.",
        score: 0.81
      }
    ],
    checks: [
      (evaluation) =>
        /\b5,336\b/.test(firstAnswer(evaluation))
          ? null
          : "Expected nationwide annual total to beat tiny partial stat.",
      (evaluation) =>
        /\b1,044\b/.test(firstAnswer(evaluation))
          ? "Top answer still reflects suspicious tiny partial stat."
          : null,
      (evaluation) =>
        evaluation.candidates.some((candidate) =>
          candidate.reasons.includes("implausible_national_total")
        )
          ? null
          : "Expected implausible national total guard to trigger."
    ]
  },
  {
    id: "price_unit_clarity",
    query: "average price of a 4 pack of pudding at kroger",
    results: [
      {
        title: "Kroger pudding listing",
        url: "https://www.kroger.com/p/snack-pack-fudge-pudding-4-pack/0001234",
        content: "Snack Pack Chocolate Fudge Pudding 4-pack at Kroger is typically $1.39.",
        score: 0.79
      },
      {
        title: "Pudding category page",
        url: "https://www.kroger.com/c/pudding",
        content: "Pudding multipacks and cups available in several flavors this week.",
        score: 0.71
      }
    ],
    checks: [
      (evaluation) =>
        PRICE_AND_PACK_PATTERN.test(firstAnswer(evaluation))
          ? null
          : "Expected price answer with currency and pack context."
    ]
  },
  {
    id: "workplace_stat_precision",
    query: "how often do people report coworkers stealing food at work",
    results: [
      {
        title: "Workplace behavior survey",
        url: "https://www.shrm.org/resourcesandtools/workplace-food-survey-2023",
        content: "In a 2023 workplace survey, 28% of employees reported coworker food theft.",
        score: 0.86
      },
      {
        title: "Office kitchen tips",
        url: "https://blog.example.com/office-kitchen-rules",
        content: "Read more about office etiquette and meal prep guidance.",
        score: 0.6
      }
    ],
    checks: [
      (evaluation) =>
        /%|\bpercent\b/i.test(firstAnswer(evaluation))
          ? null
          : "Expected percentage/statistical unit in workplace frequency answer."
    ]
  },
  {
    id: "weak_evidence_graceful_fail",
    query: "what is the best team culture metric for startups",
    results: [
      {
        title: "Navigation",
        url: "https://example.com/resources",
        content: "Menu Privacy Policy Subscribe Read more and follow us.",
        score: 0.52
      },
      {
        title: "Contributor page",
        url: "https://example.com/authors/jane",
        content: "Written by Jane. Contributor profile and article index.",
        score: 0.48
      }
    ],
    checks: [
      (evaluation) =>
        evaluation.cleanResults.length === 0
          ? null
          : "Expected clean-results empty for weak evidence case.",
      (evaluation) =>
        evaluation.retrievalQuality === "weak" || evaluation.retrievalQuality === "empty"
          ? null
          : "Expected weak/empty retrieval quality for graceful-fail case."
    ]
  },
  {
    id: "normalization_disambiguation",
    query: "how many new cameros sold nationwide last year",
    results: [
      {
        title: "GM U.S. sales release",
        url: "https://www.gm.com/investors/sales/2025-us",
        content: "GM reported 5,336 Camaro units sold nationwide in the U.S. in 2025.",
        score: 0.87
      }
    ],
    checks: [
      () =>
        normalizeQuickFactQuery("how many new cameros sold nationwide last year").includes("camaros")
          ? null
          : "Expected typo normalization cameros -> camaros.",
      () =>
        normalizeQuickFactQuery("how many new cameros sold nationwide last year").includes(String(LAST_YEAR))
          ? null
          : "Expected last-year normalization to explicit year."
    ]
  },
  {
    id: "large_number_scope_guard",
    query: "how many people visited yellowstone last year",
    results: [
      {
        title: "Yellowstone park rankings",
        url: "https://tourism.example.com/yellowstone/rankings",
        content: "Yellowstone ranked #20 in a travel list.",
        score: 0.77
      },
      {
        title: "NPS visitation statistics",
        url: "https://www.nps.gov/yell/learn/news/2025-visitation.htm",
        content: "Yellowstone hosted 4,744,353 recreation visits in 2025.",
        score: 0.82
      }
    ],
    checks: [
      (evaluation) =>
        /\b4,744,353\b/.test(firstAnswer(evaluation))
          ? null
          : "Expected large numeric total with full scope instead of ranking fragment."
    ]
  },
  {
    id: "stale_data_guard",
    query: "who won the most recent season of the voice",
    results: [
      {
        title: "The Voice season 11 recap",
        url: "https://legacy.example.com/the-voice/season-11",
        content: "Sundance Head won season 11 in 2016.",
        score: 0.84
      },
      {
        title: "The Voice season 27 finale",
        url: "https://www.nbc.com/the-voice/news/season-27-winner",
        content: "Adam David won The Voice season 27 in 2025.",
        score: 0.83
      }
    ],
    checks: [
      (evaluation) =>
        /\b(2025|season 27)\b/i.test(firstAnswer(evaluation))
          ? null
          : "Expected most-recent season answer to prefer fresher context."
    ]
  }
];

export function runQuickFactStressSuite() {
  const caseResults: QuickFactStressCaseResult[] = QUICKFACT_STRESS_CASES.map((testCase) => {
    const evaluation = evaluateQuickFactStressCase({
      query: testCase.query,
      answer: testCase.answer,
      results: testCase.results
    });
    const failures = testCase.checks
      .map((check) => check(evaluation))
      .filter((issue): issue is string => Boolean(issue));

    return {
      id: testCase.id,
      query: testCase.query,
      pass: failures.length === 0,
      failures,
      evaluation
    };
  });

  const passed = caseResults.filter((result) => result.pass).length;

  return {
    total: caseResults.length,
    passed,
    failed: caseResults.length - passed,
    caseResults
  };
}
