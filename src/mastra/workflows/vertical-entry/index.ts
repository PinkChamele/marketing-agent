// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, prepareResearch } from './steps/prepare-research.step';
import { runResearchIteration } from './steps/research-iteration.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
})
  .then(prepareResearch)
  .dountil(runResearchIteration, ({ inputData }) => Promise.resolve(inputData.passed))
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
