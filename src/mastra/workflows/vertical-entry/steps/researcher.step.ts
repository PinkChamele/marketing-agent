import z from "zod";
import { randomUUID } from "crypto";
import { createStep } from "@mastra/core/workflows";
import { researcher } from "../../../agents/researcher";

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyDescription: z
    .string()
    .min(10)
    .describe('Brief description of the outsourcing company entering the vertical'),
});

export const reportSchema = z.object({
  threadId: z
    .string()
    .describe(
      'The memory thread ID used for this run — useful for inspecting working memory afterwards',
    ),
  report: z.string().describe('The final markdown report'),
});

export const runResearcher = createStep({
  id: 'run-researcher',
  description:
    'Invokes the researcher agent to investigate the vertical and produce a strategy report',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error('Brief not provided');
    }

    const agent = mastra.getAgentById(researcher.id);
    const threadId = randomUUID();

    const prompt = `
Vertical: ${inputData.vertical}
Company description: ${inputData.companyDescription}

Produce a vertical-entry research report following your two-phase process.
    `.trim();

    const response = await agent.stream([{ role: 'user', content: prompt }], {
      memory: {
        thread: threadId,
        resource: 'default',
      },
      maxSteps: 25,
    });

    let report = '';
    for await (const chunk of response.textStream) {
      process.stdout.write(chunk);
      report += chunk;
    }

    return { threadId, report };
  },
});
