// src/mastra/schemas/research-memory.ts

import { z } from 'zod';

const confidenceLevel = z.enum(['high', 'medium', 'low']);

const marketTrendSchema = z.object({
  claim: z.string(),
  evidence: z.string(),
  sourceUrl: z.url(),
  publisher: z.string(),
  year: z.number().int().optional(),
  confidence: confidenceLevel,
});

const competitorSchema = z.object({
  name: z.string(),
  description: z.string(),
  weightClass: z.enum(['enterprise', 'mid-market', 'boutique']),
  sources: z.array(z.url()).min(1),
});

const icpSchema = z.object({
  persona: z.string(),
  pains: z.array(z.string()).min(2),
  buyingSignals: z.array(z.string()).min(1),
});

const sourceConsultedSchema = z.object({
  url: z.url(),
  classifier: z.enum([
    'government',
    'analyst',
    'consulting',
    'trade-press',
    'sec-filing',
    'company-ir',
    'vendor',
    'other',
  ]),
});

export const researchMemorySchema = z.object({
  marketTrends: z.array(marketTrendSchema),
  competitors: z.array(competitorSchema),
  candidateIcps: z.array(icpSchema),
  sourcesConsulted: z.array(sourceConsultedSchema),
  openQuestions: z.array(z.string()),
});

export type ResearchMemory = z.infer<typeof researchMemorySchema>;
