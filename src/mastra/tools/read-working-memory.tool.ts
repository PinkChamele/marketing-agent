import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { researchMemory } from '../memory';
import { researchMemorySchema, type ResearchMemory } from '../schemas/research-memory';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'read-working-memory' });

const EMPTY: ResearchMemory = {
  marketTrends: [],
  competitors: [],
  candidateIcps: [],
  sourcesConsulted: [],
  openQuestions: [],
};

export const readWorkingMemoryTool = createTool({
  id: 'read-working-memory',
  description:
    'Read the current state of the working-memory document. Returns the full structured findings (marketTrends, competitors, candidateIcps, sourcesConsulted, openQuestions). Use this to check what you have already recorded before deciding whether to add a new finding (avoid duplicates), and to get accurate counts before emitting your completion signal. Cheaper than guessing.',
  inputSchema: z.object({}),
  outputSchema: researchMemorySchema,
  execute: async (_input, { agent }) => {
    if (!agent?.threadId) {
      throw new Error('read-working-memory: agent.threadId missing from execution context');
    }

    const raw = await researchMemory.getWorkingMemory({
      threadId: agent.threadId,
      resourceId: agent.resourceId,
    });

    if (!raw) {
      log.info(`empty memory for thread ${agent.threadId}`);
      return EMPTY;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new Error(
        `Working memory is not valid JSON. Length: ${raw.length}. Head: ${raw.slice(0, 200)}`,
      );
    }

    const parsed = researchMemorySchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error('Working memory does not match the expected schema: ' + parsed.error.message);
    }

    return parsed.data;
  },
});
