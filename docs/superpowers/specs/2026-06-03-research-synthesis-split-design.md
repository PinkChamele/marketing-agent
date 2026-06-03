# Research / Synthesis Agent Split — Design

**Status:** Draft, awaiting review
**Date:** 2026-06-03

## Goal

Replace the single researcher agent with two specialized agents — `researcher` (gathers evidence, populates working memory) and `synthesizer` (reads working memory, writes the final report) — orchestrated by a three-step workflow with a deterministic validation gate between them.

## Why now

The current single agent does Phase 1 (research loop) and Phase 2 (synthesis) in one model call chain. This has three concrete pains:

- **Wrong-model-for-the-job.** The research loop is mostly mechanical (search, fetch, mine, save), well-served by a fast cheaper model. The synthesis step rewards stronger reasoning and prose. One model has to do both, which means either overpaying on the loop or underpowering the synthesis.
- **Conflated tool surface.** The synthesizer doesn't need `webSearch` or `fetchUrl` — and granting them invites the model to "just search for one more thing" mid-synthesis instead of grounding strictly in what was recorded.
- **Conflated system prompt.** Phase 1 and Phase 2 instructions live in one massive prompt re-sent every step. Each phase pays the other's token cost.

After the split each agent gets the model, tools, and instructions it needs, and nothing else.

## Architecture overview

```
brief (user message)
    │
    ▼
[Step 1: research]
    invoke researcher agent (threadId T)
    researcher uses tools, writes findings to working memory
    researcher's final assistant message = cosmetic completion signal
    │
    ▼
[Step 2: validate-memory]
    read working memory (still threadId T)
    assert minimum thresholds per schema
    fail-fast with diagnostics if not met
    │
    ▼
[Step 3: synthesize]
    invoke synthesizer agent (same threadId T)
    synthesizer reads working memory, writes the final report
    synthesizer's final assistant message = the report
    scorers run on this output
    │
    ▼
report (workflow output)
```

The two agents share working memory because they're invoked on the same Mastra thread.

## Working memory schema

Working memory becomes the *typed contract* between agents. A Zod schema replaces the current free-form markdown template. Mastra validates writes; the validation gate checks counts.

```ts
// src/mastra/schemas/research-memory.ts

import { z } from 'zod';

const confidenceLevel = z.enum(['high', 'medium', 'low']);

const marketTrendSchema = z.object({
  claim: z.string(),
  evidence: z.string(),     // quoted snippet from the source
  sourceUrl: z.url(),
  publisher: z.string(),    // e.g. "Gartner", "HHS.gov"
  year: z.number().int().optional(),
  confidence: confidenceLevel,
});

const competitorSchema = z.object({
  name: z.string(),
  description: z.string(),          // 1-3 sentences
  weightClass: z.enum(['enterprise', 'mid-market', 'boutique']),
  sources: z.array(z.url()).min(1),
});

const icpSchema = z.object({
  persona: z.string(),              // "Director of Engineering at $50M-$500M regional bank"
  pains: z.array(z.string()).min(2),
  buyingSignals: z.array(z.string()).min(1),
});

const sourceConsultedSchema = z.object({
  url: z.url(),
  classifier: z.enum([
    'government', 'analyst', 'consulting',
    'trade-press', 'sec-filing', 'company-ir',
    'vendor', 'other',
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
```

Notes on the schema:

- `marketTrendSchema.evidence` is a quoted snippet, not the agent's paraphrase — preserves traceability.
- `competitorSchema.weightClass` formalizes the "TCS vs nearshore shop" distinction the current researcher prompt teaches.
- `sourceConsultedSchema.classifier` lets `source-diversity` (and future research-quality scorers) reason about *source type*, not just domain.
- All arrays start unconstrained at the schema level — the validation gate enforces minimums, not Zod. This keeps Mastra's write validation focused on shape, with quantity checks one layer up where their thresholds are tunable.

## Workflow steps

### Step 1: `research`

- **Input:** `{ brief: string }` (the user's brief — vertical + company description).
- **Action:**
  - Construct or accept a `threadId` (workflow scope).
  - Invoke `researcher` agent with the brief on that thread.
  - Researcher loops: search, fetch, mine, save findings into `researchMemory`.
- **Output:** `{ threadId: string, completionSignal: string }`.
  - `completionSignal` is the researcher's final assistant message (cosmetic; for human visibility in Studio).

### Step 2: `validate-memory`

- **Input:** `{ threadId: string }`.
- **Action:**
  - Read working memory via Mastra Memory API.
  - Parse against `researchMemorySchema` (defensive — Mastra should have enforced shape on writes).
  - Check minimum thresholds:
    - `marketTrends.length >= 3`
    - `competitors.length >= 3`
    - `candidateIcps.length >= 2`
    - `sourcesConsulted.length >= 5`
    - For each `marketTrend` with a quantitative claim (contains `$`, `%`, or a 4-digit year), require that another source in `sourcesConsulted` shares its `publisher` OR another `marketTrend` cites the same claim from a different `sourceUrl`. (Triangulation rule.)
  - If any threshold fails, throw a `WorkflowError` with the deficits listed. The workflow halts here; no synthesis on insufficient input.
- **Output:** `{ memory: ResearchMemory }` passed through to step 3.

### Step 3: `synthesize`

- **Input:** `{ threadId: string, memory: ResearchMemory }`.
- **Action:**
  - Invoke `synthesizer` agent on the same thread.
  - Synthesizer reads the validated memory (already in its working-memory view) plus the original user brief (still in conversation history).
  - Writes the final report as its assistant message.
- **Output:** `{ report: string }` — workflow's overall output.

## Agent specifications

### `researcher` (rewritten)

| Aspect | Value |
|---|---|
| **Model** | `model(ModelRole.Researcher)()` (Sonnet / Haiku / GPT-5-mini class) |
| **Tools** | `webSearchTool`, `fetchTool` |
| **Memory** | Shared `researchMemory` with `researchMemorySchema` |
| **Scorers** | None |
| **`defaultOptions.maxSteps`** | 25 (unchanged) |

**Prompt focus:**

- Opening: "Your job is to populate the working-memory document. The final report will be written by another agent reading **only** that document — if a finding is not in working memory when you finish, it does not exist."
- Keep all of Phase 1 from the current prompt: source-bias whitelist, exclusion lists, snippet-mining first, recovery protocol for blocked fetches, triangulation rule, confidence levels.
- **Remove all of Phase 2** (the synthesis instructions, the citation format rules, the report section structure). Those move to the synthesizer.
- **Final message contract:** "After your last working-memory write, emit a single short message in this shape: `Recorded N trends, M competitors, K ICPs, S sources, Q open questions.` Nothing else. Do not summarize findings; the workflow reads memory directly."

### `synthesizer` (new)

| Aspect | Value |
|---|---|
| **Model** | `model(ModelRole.Synthesizer)()` (Opus 4.7 or equivalent) |
| **Tools** | None |
| **Memory** | Same `researchMemory` (read access via working memory) |
| **Scorers** | citationFormat, citationIntegrity, sourceDiversity, companyFit, claimGrounding (all 5) |
| **`defaultOptions`** | `{ maxSteps: 1, modelSettings: { maxRetries: 6 } }` |

`maxSteps: 1` because there are no tools — one model call produces the report.

**Prompt focus:**

- Opening: "You are a market research analyst and marketing strategist. Read the structured findings in working memory and write a vertical-entry research report. You may use **only** what is in working memory and the original user brief; do not introduce facts from training data. If working memory lacks evidence for a claim you want to make, drop the claim or flag it under Confidence & Gaps."
- All of Phase 2 from the current prompt: report structure (Executive Summary → Market Trends → Competitor Landscape → Candidate ICPs → Fit Analysis → Positioning → Confidence & Gaps → Sources), citation format (`(Source: Publisher, Year) [N]` inline plus a numbered Sources list).
- **Sourcing rule:** every numbered reference in the Sources section must correspond to an entry in `sourcesConsulted` or to a `sourceUrl` from a finding. The synthesizer cannot invent URLs.
- **Adjacent-enterprise-players framing** (the "TCS vs nearshore shop" rule) — moves here, since it's a synthesis-time judgment.

## Memory access pattern

Mastra `Memory` is per-thread. The workflow holds a single `threadId` for the entire run and passes it to both agent invocations. The `researchMemory` instance is registered in `Mastra` once and shared.

Both agents must be configured with the same Memory instance — *not* separate Memory configs that happen to have the same schema. Otherwise the synthesizer reads a different scope and sees nothing.

## Scorer placement

All five existing scorers detach from the researcher and attach to the synthesizer:

- `citationFormatScorer`
- `citationIntegrityScorer`
- `sourceDiversityScorer`
- `companyFitScorer`
- `claimGroundingScorer`

No scorer logic changes. The Mastra registration (`src/mastra/index.ts`) keeps them as registered scorers; only the agent-level `scorers` config moves.

`preprocessRun`'s brief-extraction (concat user-role messages across `rememberedMessages` + `inputMessages`) continues to work — the synthesizer sees the user's brief in `rememberedMessages` and an empty `inputMessages` on the synthesis turn.

## What's deferred (out of scope for this design)

- **Research-quality scorers.** Memory-aware scorers that grade the *findings* (source diversity by classifier, triangulation count, finding density) — interesting but a separate change. Build them only after the split itself is observed working.
- **Synthesizer retries.** If the synthesizer's output fails one of the existing scorers (e.g. orphan `[N]` references), no automatic retry — that's the operator's signal to inspect manually. A retry policy can come later.
- **Persistent memory across workflow runs.** Each workflow run uses a fresh thread, so memory is isolated per-run. We're not sharing findings across briefs.

## Files affected

Estimate of files touched:

- **New:** `src/mastra/schemas/research-memory.ts`, `src/mastra/agents/synthesizer.ts`.
- **Modified:** `src/mastra/agents/researcher.ts` (rewrite — Phase 1 only, no scorers, cosmetic final message), `src/mastra/workflows/vertical-entry.ts` (three-step orchestration with validation gate), `src/mastra/memory.ts` (or wherever `researchMemory` is defined — add the Zod schema), `src/mastra/index.ts` (register the synthesizer).

## Risks and open questions

- **What if the researcher emits its completion signal *before* it's actually finished writing memory?** Mitigation: the validation gate doesn't trust the signal; it reads memory directly. Worst case: gate fails, workflow halts, no garbage downstream.
- **What if Mastra working memory has eventual-consistency between write and the next read?** Need to verify against the Mastra version. If yes, the validate-memory step needs a small delay or a synchronous read-after-write barrier. Will check during implementation.
- **Synthesizer model context length.** Memory + brief + system prompt should comfortably fit a 200k+ context model. Worth measuring once we see realistic memory sizes.
- **What if the agent writes to memory but uses different field names than the schema?** Mastra's schema-validated working memory rejects malformed writes; the agent gets an error and (hopefully) corrects. This is the same correction loop that `tool-call-leak-recovery` uses elsewhere.

## Decisions locked in

- Working memory: Zod schema (typed contract).
- Workflow: three explicit steps with a deterministic validation gate.
- Researcher's final message: cosmetic only — gate reads memory directly.
- Models: `ModelRole.Researcher` for the loop, `ModelRole.Synthesizer` for the report.
- Same thread for both agents.
- Scorers all move from researcher to synthesizer; no logic changes.
