import { z } from 'zod';
import { createScorer } from '@mastra/core/evals';
import { model } from '../../modules/model';
import { ModelRole } from '../../modules/model';
import { INCOMPLETE_MSG, preprocessRun } from './extract-report-text';

/**
 * Marker the analyze step emits when the agent run didn't produce a real
 * final report. The judge isn't actually consulted in that case — we send
 * a ~50-token short-circuit prompt that just asks the model to echo this
 * sentinel, then `generateScore` / `generateReason` detect it and report
 * a skipped result. Saves ~98% of judge token cost on broken runs.
 */
const SKIPPED_NOTE_MARKER = '__SKIPPED__';

export const companyFitScorer = createScorer({
  id: 'company-fit',
  description:
    'Checks whether the report tailors analysis to the specific company in the brief, vs. generic output',
  judge: {
    model: model(ModelRole.Cheap)(),
    instructions: 'You are a strict evaluator of market-entry research quality.',
  },
})
  .preprocess(({ run }) => preprocessRun(run))
  .analyze({
    description: 'Assess how well the report uses company specifics',
    outputSchema: z.object({
      usesCompanySize: z.boolean(),
      usesTechStack: z.boolean(),
      usesDomainHistory: z.boolean(),
      addressesWeightClass: z.boolean(),
      flagsSpecificGaps: z.boolean(),
      genericnessNote: z.string(),
    }),
    createPrompt: ({ results }) => {
      const { text, brief, isComplete } = results.preprocessStepResult;

      if (!isComplete) {
        // Minimal short-circuit prompt — Mastra always invokes analyze when
        // it's defined, so we can't skip the LLM call, but we can make it
        // tiny. ~50 tokens instead of ~3000.
        return [
          'Respond with exactly this JSON and nothing else:',
          JSON.stringify({
            usesCompanySize: false,
            usesTechStack: false,
            usesDomainHistory: false,
            addressesWeightClass: false,
            flagsSpecificGaps: false,
            genericnessNote: SKIPPED_NOTE_MARKER,
          }),
        ].join('\n');
      }

      return `
A research report was produced for THIS company brief:
"""
${brief}
"""

Evaluate whether the report below actually TAILORS its analysis to this specific
company, or whether it reads as generic content that would fit any mid-size
outsourcer. Answer each boolean honestly.

Report:
"""
${text}
"""
      `.trim();
    },
  })
  .generateScore(({ results }) => {
    if (!results.preprocessStepResult.isComplete) return 0;

    const a = results.analyzeStepResult;
    const checks = [
      a.usesCompanySize,
      a.usesTechStack,
      a.usesDomainHistory,
      a.addressesWeightClass,
      a.flagsSpecificGaps,
    ];

    return checks.filter(Boolean).length / checks.length;
  })
  .generateReason(({ results }) =>
    results.preprocessStepResult.isComplete
      ? results.analyzeStepResult.genericnessNote
      : INCOMPLETE_MSG,
  );
