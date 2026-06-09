import { RequestContext } from '@mastra/core/request-context';
import { researcher } from '../../../agents/researcher';
import type { Mastra } from '@mastra/core/mastra';

export interface InvokeResearcherOptions {
  mastra: Mastra;
  threadId: string;
  resourceId: string;
  runId: string;
  prompt: string;
  maxSteps?: number;
}

export interface InvokeResearcherResult {
  completionSignal: string;
}

/**
 * Run the researcher agent on a given thread with the supplied prompt,
 * stream stdout in real time, and return the accumulated text. Used by
 * both the initial research step and the refine retry step — both pass
 * different prompts but share the streaming-consumption boilerplate.
 */
export async function invokeResearcher(
  opts: InvokeResearcherOptions,
): Promise<InvokeResearcherResult> {
  const agent = opts.mastra.getAgentById(researcher.id);
  const requestContext = new RequestContext<{ runId: string }>([['runId', opts.runId]]);

  const response = await agent.stream([{ role: 'user', content: opts.prompt }], {
    memory: { thread: opts.threadId, resource: opts.resourceId },
    requestContext,
    maxSteps: opts.maxSteps ?? 60,
  });

  let completionSignal = '';
  for await (const chunk of response.textStream) {
    process.stdout.write(chunk);
    completionSignal += chunk;
  }

  return { completionSignal };
}
