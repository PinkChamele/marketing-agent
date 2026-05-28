import { Memory } from '@mastra/memory';
import { storage } from './storage';

export const researchMemory = new Memory({
  storage,
  options: {
    workingMemory: {
      enabled: true,
      scope: 'thread',
      template: `
# Research Brief

## Market Trends
## Competitors
## Candidate ICPs
## Open Questions
## Sources Consulted
      `.trim(),
    },
  },
});
