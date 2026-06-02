import { createWorkflow } from '@mastra/core/workflows';
import { briefSchema, reportSchema, runResearcher } from './steps/researcher.step';



const verticalEntryWorkflow = createWorkflow({
  id: 'vertical-entry-workflow',
  inputSchema: briefSchema,
  outputSchema: reportSchema,
}).then(runResearcher);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
