import { runQuickFactStressSuite } from "@/lib/quickfact-stress";

function printCaseResult(result: ReturnType<typeof runQuickFactStressSuite>["caseResults"][number]) {
  const status = result.pass ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${result.id}`);
  console.log(`Query: ${result.query}`);
  console.log(`Normalized: ${result.evaluation.normalizedQuery || "(none)"}`);
  console.log(`Type: ${result.evaluation.queryType}`);
  console.log(`Retrieval quality: ${result.evaluation.retrievalQuality}`);

  const topAnswer = result.evaluation.cleanResults[0]?.answer ?? "(no clean answer)";
  console.log(`Top answer: ${topAnswer}`);

  if (result.failures.length > 0) {
    result.failures.forEach((failure) => {
      console.log(`  - ${failure}`);
    });
  }
}

function main() {
  const summary = runQuickFactStressSuite();
  console.log(`QuickFact stress suite: ${summary.passed}/${summary.total} passed`);

  summary.caseResults.forEach((result) => {
    printCaseResult(result);
  });

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main();

