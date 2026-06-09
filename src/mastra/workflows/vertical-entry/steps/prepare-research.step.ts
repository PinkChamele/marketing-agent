// src/mastra/workflows/vertical-entry/steps/prepare-research.step.ts

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { getProfile } from '../../../../modules/companies';
import { env } from '../../../../config/env';

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Key identifying which company profile from src/modules/companies/ to use. Falls back to DEFAULT_COMPANY_KEY env var when omitted.',
    ),
});

/**
 * State shape that flows through the research-iteration loop.
 * dountil requires the step's input and output schemas to match, so this
 * type is reused for both. `passed` is the loop's exit signal; `attempt`
 * is the iteration counter; `completionSignal` carries the latest agent
 * completion message for downstream tracing.
 */
export const iterationStateSchema = z.object({
  threadId: z.string(),
  resourceId: z.string(),
  vertical: z.string(),
  companyName: z.string(),
  companyFacts: z.string(),
  companyVerified: z.string(),
  attempt: z.number().int().nonnegative(),
  completionSignal: z.string(),
  passed: z.boolean(),
});

export const prepareResearch = createStep({
  id: 'prepare-research',
  description:
    'Resolves the company profile from the brief, mints a fresh threadId, and seeds the iteration state with attempt:0 / passed:false. The dountil loop runs after this step.',
  inputSchema: briefSchema,
  outputSchema: iterationStateSchema,
  execute: ({ inputData }) => {
    if (!inputData) throw new Error('Brief not provided');

    const companyKey = inputData.companyKey ?? env.DEFAULT_COMPANY_KEY;
    if (!companyKey) {
      throw new Error(
        'No companyKey in workflow input and DEFAULT_COMPANY_KEY env var is not set',
      );
    }
    const profile = getProfile(companyKey);
    if (!profile) {
      throw new Error(`Unknown companyKey: "${companyKey}"`);
    }

    return Promise.resolve({
      threadId: randomUUID(),
      resourceId: 'default',
      vertical: inputData.vertical,
      companyName: profile.name,
      companyFacts: profile.facts,
      companyVerified: profile.lastVerified,
      attempt: 0,
      completionSignal: '',
      passed: false,
    });
  },
});
