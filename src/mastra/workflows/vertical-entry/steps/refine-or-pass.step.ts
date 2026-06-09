// src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts

import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { researchMemory } from '../../../memory';
import {
  researchMemorySchema,
  type ResearchMemory,
} from '../../../schemas/research-memory';
import { researchOutputSchema } from './research.step';
import { invokeResearcher } from './invoke-researcher';
import { clearCache } from './cache-cleanup';

export const refineOutputSchema = researchOutputSchema.extend({
  passed: z.boolean(),
});

const MIN_TRENDS = 3;
const MIN_COMPETITORS = 3;
const MIN_ICPS = 2;
const MIN_SOURCES = 5;
const QUANT_CLAIM_REGEX = /\$|\d+(?:\.\d+)?\s*%/;
const MAX_ATTEMPTS = 3;

export const refineOrPass = createStep({
  id: 'refine-or-pass',
  description:
    'Reads working memory; if thresholds are met returns passed:true. Otherwise invokes the researcher again with corrective feedback naming the specific deficits. Throws when MAX_ATTEMPTS is reached.',
  inputSchema: researchOutputSchema,
  outputSchema: refineOutputSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const raw = await researchMemory.getWorkingMemory({
      threadId: inputData.threadId,
      resourceId: inputData.resourceId,
    });

    if (!raw) {
      await clearCache(runId);
      throw new Error(
        'Researcher produced no working memory. The synthesizer has no input — halting.',
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      await clearCache(runId);
      throw new Error(
        `Working memory is not valid JSON. Length: ${raw.length}. Head: ${raw.slice(0, 200)}`,
      );
    }

    const parsed = researchMemorySchema.safeParse(parsedJson);
    if (!parsed.success) {
      await clearCache(runId);
      throw new Error(
        'Working memory does not match the expected schema: ' + parsed.error.message,
      );
    }

    const deficits = collectDeficits(parsed.data);

    if (deficits.length === 0) {
      await clearCache(runId);
      return { ...inputData, passed: true };
    }

    if (inputData.attempt >= MAX_ATTEMPTS) {
      await clearCache(runId);
      throw new Error(
        `Research insufficient after ${inputData.attempt} attempts:\n  - ` +
          deficits.join('\n  - '),
      );
    }

    const correctivePrompt = `
The quality check found these gaps in your research:

${deficits.map((d) => `  - ${d}`).join('\n')}

Use your tools to address each gap. Your existing findings are still in
working memory — only fill in what's missing. When done, emit your
completion signal again in exactly this shape:
\`Recorded N trends, M competitors, K ICPs, S sources, Q open questions.\`
with the updated counts.
    `.trim();

    let completionSignal: string;
    try {
      ({ completionSignal } = await invokeResearcher({
        mastra,
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
        runId,
        prompt: correctivePrompt,
      }));
    } catch (err) {
      await clearCache(runId);
      throw err;
    }

    return {
      ...inputData,
      completionSignal,
      attempt: inputData.attempt + 1,
      passed: false,
    };
  },
});

function collectDeficits(m: ResearchMemory): string[] {
  const deficits: string[] = [];

  if (m.marketTrends.length < MIN_TRENDS) {
    deficits.push(
      `marketTrends: got ${m.marketTrends.length}, need >= ${MIN_TRENDS}`,
    );
  }
  if (m.competitors.length < MIN_COMPETITORS) {
    deficits.push(
      `competitors: got ${m.competitors.length}, need >= ${MIN_COMPETITORS}`,
    );
  }
  if (m.candidateIcps.length < MIN_ICPS) {
    deficits.push(
      `candidateIcps: got ${m.candidateIcps.length}, need >= ${MIN_ICPS}`,
    );
  }
  if (m.sourcesConsulted.length < MIN_SOURCES) {
    deficits.push(
      `sourcesConsulted: got ${m.sourcesConsulted.length}, need >= ${MIN_SOURCES}`,
    );
  }

  // Triangulation: every quantitative trend needs corroboration from
  // another trend citing a different sourceUrl AND a different publisher.
  for (const trend of m.marketTrends) {
    const looksQuantitative =
      QUANT_CLAIM_REGEX.test(trend.claim) || QUANT_CLAIM_REGEX.test(trend.evidence);
    if (!looksQuantitative) continue;

    const corroborated = m.marketTrends.some(
      (other) =>
        other !== trend &&
        other.sourceUrl !== trend.sourceUrl &&
        other.publisher !== trend.publisher &&
        (QUANT_CLAIM_REGEX.test(other.claim) || QUANT_CLAIM_REGEX.test(other.evidence)),
    );
    if (!corroborated) {
      deficits.push(
        `quantitative trend "${trend.claim.slice(0, 60)}…" has no second corroborating source`,
      );
    }
  }

  return deficits;
}
