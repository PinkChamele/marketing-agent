import { z } from 'zod';
import { createScorer } from '@mastra/core/evals';
import { model } from '../../modules/model';
import { ModelRole } from '../../modules/model';
import { INCOMPLETE_MSG } from './constants';
import { buildSkipPrompt, preprocessRun } from './utils';

export const companyFitScorer = createScorer({
  id: 'company-fit',
  type: 'agent',
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
        return buildSkipPrompt({
          usesCompanySize: false,
          usesTechStack: false,
          usesDomainHistory: false,
          addressesWeightClass: false,
          flagsSpecificGaps: false,
          genericnessNote: '',
        });
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
