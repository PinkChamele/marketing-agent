// src/mastra/workflows/vertical-entry/index.ts

import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, runResearch } from './steps/research.step';
import { refineOrPass } from './steps/refine-or-pass.step';
import { reportSchema, runSynthesis } from './steps/synthesize.step';

const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
})
  .then(runResearch)
  .dountil(refineOrPass, ({ inputData }) => Promise.resolve(inputData.passed))
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
