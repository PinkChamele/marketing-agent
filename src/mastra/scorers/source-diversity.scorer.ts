import { createScorer } from '@mastra/core/evals';
import { INCOMPLETE_MSG, preprocessRun } from './extract-report-text';

function extractDomains(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)\]】"']+/g) ?? [];
  const domains = urls
    .map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  return [...new Set(domains)];
}

export const sourceDiversityScorer = createScorer({
  id: 'source-diversity',
  description: 'Rewards reports that triangulate across multiple independent sources',
})
  .preprocess(({ run }) => {
    const base = preprocessRun(run);
    return {
      isComplete: base.isComplete,
      domains: base.isComplete ? extractDomains(base.text) : [],
    };
  })
  .generateScore(({ results }) => {
    const { isComplete, domains } = results.preprocessStepResult;

    if (!isComplete) return 0;
    if (domains.length === 0) return 0;
    if (domains.length <= 2) return 0.4;
    if (domains.length <= 4) return 0.7;

    return 1;
  })
  .generateReason(({ score, results }) => {
    const { isComplete, domains } = results.preprocessStepResult;

    return isComplete
      ? `Report cites ${domains.length} distinct source domain(s). Score: ${score}.`
      : INCOMPLETE_MSG;
  });
