# Research retry loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fail-fast `validate-memory` gate with a self-correcting loop: `research → dountil(refineOrPass)`. When working memory falls short of thresholds, the workflow re-invokes the researcher agent **on the same thread** with corrective feedback naming the specific deficits. Hard-capped at 3 total research attempts; throws with the same error as today when exhausted.

**Architecture:** Mastra's native `dountil` primitive iterates a step until its output's condition is true. The new `refineOrPass` step does double duty: read memory + check thresholds, and if deficits exist, run another bounded research pass with a corrective prompt before returning `passed: false`. When deficits are clean it returns `passed: true` and the loop exits. The agent's thread continues across iterations so prior findings accumulate instead of restarting.

**Key design choices:**
- Same thread for retries → working memory accumulates; agent only fills gaps.
- Hard cap (MAX_ATTEMPTS = 3 total) → bounded budget worst case.
- Corrective prompt names specific deficits → actionable feedback, not "do better".
- Attempt counter rides through the step output → no workflow-state plumbing required.
- Researcher agent invocation extracted into a shared helper → reuse between initial research and refine pass.

**Spec reference:** prior conversation discussion deciding workflow-level loop over in-step retry (more Studio-observable, clean separation).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts` | **Create** | Shared helper: `invokeResearcher(opts)` wraps `agent.stream` + textStream consumption |
| `src/mastra/workflows/vertical-entry/steps/research.step.ts` | **Modify** | Use the new helper; output now includes `attempt: 1` |
| `src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts` | **Create** | Reads memory, computes deficits, runs corrective research if needed, throws at max attempts |
| `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts` | **Modify** | Update input schema reference to point at refine-or-pass output (same shape, just renamed) |
| `src/mastra/workflows/vertical-entry/index.ts` | **Modify** | Replace `.then(validateMemory)` with `.dountil(refineOrPass, (out) => out.passed)` |
| `src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts` | **Delete** | Superseded by refine-or-pass |

---

## Task 1: Extract researcher-invocation helper; research step uses it

**Files:**
- Create: `src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/research.step.ts`

This task is purely a refactor — no behavior change. It teases out the `agent.stream` + streaming-loop boilerplate so the refine step (Task 2) can reuse it without duplicating logic.

- [ ] **Step 1: Create the helper**

`src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts`:

```ts
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
```

- [ ] **Step 2: Rewrite `research.step.ts` to use the helper**

Replace the body with:

```ts
// src/mastra/workflows/vertical-entry/steps/research.step.ts

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createStep } from '@mastra/core/workflows';
import { getProfile } from '../../../../modules/companies';
import { env } from '../../../../config/env';
import { invokeResearcher } from './invoke-researcher';

export const briefSchema = z.object({
  vertical: z
    .string()
    .min(2)
    .describe("The industry vertical to research, e.g. 'healthcare IT outsourcing'"),
  companyKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Key identifying which company profile from src/modules/companies/ to use. Falls back to DEFAULT_COMPANY_KEY env var when omitted.',
    ),
});

export const researchOutputSchema = z.object({
  threadId: z.string(),
  resourceId: z.string(),
  vertical: z.string(),
  companyName: z.string(),
  companyFacts: z.string(),
  completionSignal: z.string(),
  attempt: z.number().int().positive(),
});

export const runResearch = createStep({
  id: 'run-research',
  description:
    'Invokes the researcher agent on a fresh thread to populate working memory with structured findings (first pass)',
  inputSchema: briefSchema,
  outputSchema: researchOutputSchema,
  execute: async ({ inputData, mastra, runId }) => {
    if (!inputData) throw new Error('Brief not provided');

    const companyKey = inputData.companyKey ?? env.DEFAULT_COMPANY_KEY;
    if (!companyKey) {
      throw new Error(
        'No companyKey in workflow input and DEFAULT_COMPANY_KEY env var is not set',
      );
    }
    const profile = getProfile(companyKey);
    if (!profile) {
      throw new Error(`Unknown companyKey: "${companyKey}"`);
    }

    const threadId = randomUUID();
    const resourceId = 'default';

    const prompt = `
Vertical: ${inputData.vertical}
Company: ${profile.name}
Profile (verified ${profile.lastVerified}):
${profile.facts}

Populate working memory with structured findings, then emit your completion signal.
    `.trim();

    const { completionSignal } = await invokeResearcher({
      mastra,
      threadId,
      resourceId,
      runId,
      prompt,
    });

    return {
      threadId,
      resourceId,
      vertical: inputData.vertical,
      companyName: profile.name,
      companyFacts: profile.facts,
      completionSignal,
      attempt: 1,
    };
  },
});
```

Notes:
- `resourceId` is now in the output schema so `refineOrPass` doesn't have to hardcode `'default'` in two places.
- `attempt: 1` seeds the retry counter — Task 2's step will increment.
- The leftover `try/finally` for cache cleanup stays AT THE WORKFLOW LEVEL, not in research.step. Wait — currently it's in research.step.ts. After the workflow restructure, the cleanup needs to happen after BOTH research and refine, so move it. Actually: the cleanest move is to leave it for Task 2 (when the workflow itself changes shape) — for now in Task 1, preserve the existing `try/finally` block around the helper invocation in research.step.ts so behavior matches today.

Concrete final shape including the finally:

```ts
execute: async ({ inputData, mastra, runId }) => {
  // ... profile resolution above ...

  const threadId = randomUUID();
  const resourceId = 'default';

  try {
    const { completionSignal } = await invokeResearcher({
      mastra, threadId, resourceId, runId, prompt,
    });
    return { threadId, resourceId, vertical: inputData.vertical, companyName: profile.name, companyFacts: profile.facts, completionSignal, attempt: 1 };
  } finally {
    try {
      await getCache().clear(runId);
    } catch (err) {
      log.warn(`Failed to clear page cache for run ${runId}: ${getErrMsg(err)} — entries will expire via TTL`);
    }
  }
},
```

**Important:** the cache-clear in `finally` will fire AFTER THE FIRST RESEARCH PASS — but the refine step (Task 2) also fetches pages on the same `runId`. So the cache would be empty for refine attempts.

**Fix:** in Task 1 we keep the cache clear here (no behavior change yet). Task 2 will MOVE the cache clear to after the loop exits. So in Task 1 the cache clears too eagerly, but Task 2 immediately fixes it. The intermediate state is functionally OK because Task 1 doesn't yet exercise the refine path.

Add this note as a comment in the file:

```ts
// NOTE: cache clear moves to refine-or-pass.step in Task 2 once the
// retry loop lands. For now it stays here to preserve existing behavior.
```

- [ ] **Step 3: Build, lint, tsc**

`npm run build && npm run lint && npx tsc --noEmit` — all clean.

- [ ] **Step 4: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/invoke-researcher.ts \
        src/mastra/workflows/vertical-entry/steps/research.step.ts
git commit -m "Extract researcher invocation helper; research step uses it

No behavior change. The agent.stream + textStream consumption logic is
now in invoke-researcher.ts so the upcoming refine-or-pass step can
reuse it without duplicating boilerplate. researchOutputSchema gains
resourceId and attempt:1 fields to seed the retry-loop iterator."
```

---

## Task 2: refine-or-pass step + dountil workflow

**Files:**
- Create: `src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/synthesize.step.ts`
- Modify: `src/mastra/workflows/vertical-entry/index.ts`
- Modify: `src/mastra/workflows/vertical-entry/steps/research.step.ts` (move cache clear out)
- Delete: `src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts`

This task IS the atomic flip — the workflow shape changes from `.then(validate)` to `.dountil(refineOrPass)`, the cache lifecycle moves, the synthesize step's input reference updates. One commit.

- [ ] **Step 1: Create the refine-or-pass step**

`src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts`:

```ts
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
      throw new Error(
        'Researcher produced no working memory. The synthesizer has no input — halting.',
      );
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
      throw new Error(
        'Working memory does not match the expected schema: ' + parsed.error.message,
      );
    }

    const deficits = collectDeficits(parsed.data);

    if (deficits.length === 0) {
      return { ...inputData, passed: true };
    }

    if (inputData.attempt >= MAX_ATTEMPTS) {
      throw new Error(
        `Research insufficient after ${inputData.attempt} attempts:\n  - ` + deficits.join('\n  - '),
      );
    }

    const correctivePrompt = `
The validate gate found these gaps in your research:

${deficits.map((d) => `  - ${d}`).join('\n')}

Use your tools to address each gap. Your existing findings are still in
working memory — only fill in what's missing. When done, emit your
completion signal again with the updated counts.
    `.trim();

    const { completionSignal } = await invokeResearcher({
      mastra,
      threadId: inputData.threadId,
      resourceId: inputData.resourceId,
      runId,
      prompt: correctivePrompt,
    });

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
```

Notes:
- Identical deficit logic to the old `validate-memory.step.ts` — pure relocation plus the new retry path.
- `inputData.attempt` is incremented every time the step runs corrective research; the loop's exit condition `out.passed === true` short-circuits.
- The corrective prompt is short, names deficits, and reminds the agent that prior findings persist.
- `MAX_ATTEMPTS = 3` is the hard cap (initial pass via research.step counts as attempt 1; refine can add 2 more retries before throwing).

- [ ] **Step 2: Move cache cleanup out of research.step.ts into refine-or-pass.step.ts (success-path branch only)**

`research.step.ts`: remove the `try/finally` wrapping `invokeResearcher`. The cache must NOT be cleared between research and refine — refine needs the cached pages.

`refine-or-pass.step.ts`: when `deficits.length === 0` (the only path that exits the loop successfully), clear the cache **before** returning `{ passed: true }`. When deficits exist and we throw, also clear in a `finally`-style block.

Wait, the cleaner shape is: clear the cache **once** after the loop exits, regardless of pass/fail. That's the workflow-level concern.

But Mastra doesn't have a "workflow `finally`" primitive. We can either:
- Clear in the `passed: true` branch + in the `throw` paths
- Add a separate post-loop step that always runs

The simplest: clear in BOTH branches inside `refine-or-pass`. The cache lives for the duration of the research loop and exits when refine-or-pass terminates.

Revise `refine-or-pass.step.ts`:

Add imports:
```ts
import { getCache } from '../../../../modules/page-cache';
import { logger } from '../../../../utils/logger';
import { getErrMsg } from '../../../../utils/errors';

const log = logger.child({ module: 'refine-or-pass' });

async function clearCache(runId: string): Promise<void> {
  try {
    await getCache().clear(runId);
  } catch (err) {
    log.warn(`Failed to clear page cache for run ${runId}: ${getErrMsg(err)} — entries will expire via TTL`);
  }
}
```

Clear at three points in `refine-or-pass`:
1. `if (deficits.length === 0) { await clearCache(runId); return { ...inputData, passed: true }; }`
2. `if (inputData.attempt >= MAX_ATTEMPTS) { await clearCache(runId); throw new Error(...); }`
3. The corrective-research branch does NOT clear — refine may be called again, the cache stays warm.

Update research.step.ts: remove imports for `getCache`, `getErrMsg`, `logger`, the `log` const, and the entire `try/finally` block. The execute body becomes a straight call to `invokeResearcher` + return.

- [ ] **Step 3: Update synthesize step input schema reference**

`synthesize.step.ts`:

```ts
import { refineOutputSchema } from './refine-or-pass.step';
// ...
inputSchema: refineOutputSchema,
```

(Replace the import of `validateOutputSchema` from `./validate-memory.step`.)

The synthesize step reads `inputData.vertical`, `inputData.companyName`, `inputData.companyFacts`, `inputData.threadId`. All present in `refineOutputSchema`. No other changes.

- [ ] **Step 4: Update workflow to use dountil**

`src/mastra/workflows/vertical-entry/index.ts`:

```ts
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
  .dountil(refineOrPass, async ({ inputData }) => inputData.passed)
  .then(runSynthesis);

verticalEntryWorkflow.commit();

export { verticalEntryWorkflow };
```

If `dountil`'s condition signature differs in this Mastra version (e.g. receives the step result via a different shape), adjust accordingly — verify against `node_modules/@mastra/core/dist/workflows/workflow.d.ts`.

- [ ] **Step 5: Delete validate-memory.step.ts**

```bash
git rm src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts
```

- [ ] **Step 6: Verify**

```bash
npm run build && npm run lint && npx tsc --noEmit
```

All clean.

- [ ] **Step 7: Commit**

```bash
git add src/mastra/workflows/vertical-entry/steps/refine-or-pass.step.ts \
        src/mastra/workflows/vertical-entry/steps/synthesize.step.ts \
        src/mastra/workflows/vertical-entry/steps/research.step.ts \
        src/mastra/workflows/vertical-entry/index.ts \
        src/mastra/workflows/vertical-entry/steps/validate-memory.step.ts
git commit -m "Self-correcting research loop via dountil(refineOrPass)

Replace the fail-fast validate-memory gate with a workflow-level loop
that re-invokes the researcher when working memory is short of
thresholds:

- refine-or-pass reads memory, runs the same deficit checks as the old
  validate step, and either returns passed:true (loop exits) or runs a
  corrective research pass on the SAME thread with a prompt naming the
  specific gaps, returning passed:false to iterate. Hard-capped at 3
  total attempts (initial research + 2 retries); throws with the same
  error as the old gate when exhausted.
- invoke-researcher helper (extracted in the prior commit) is reused
  so both the initial pass and refines share the streaming logic.
- Cache lifecycle moves from research.step's try/finally to the
  refine-or-pass exit paths. The cache stays warm across retries; the
  cleanup runs once when the loop terminates (pass OR max-attempts
  throw).
- Synthesize input schema now references refineOutputSchema (same
  shape, just renamed).
- validate-memory.step.ts deleted."
```

---

## Manual verification (after Task 2 lands)

- [ ] **Check 1: Success in one pass.** Run the workflow with a brief that the researcher handles cleanly. Trace shows `run-research → refine-or-pass (passed:true)` then synthesize. The loop exits after the first refine evaluation.

- [ ] **Check 2: Recovery via retry.** Construct a brief where you expect the researcher's first pass to come up 1 trend short (or temporarily lower the model power). Trace shows `run-research → refine-or-pass (passed:false, attempt:2) → refine-or-pass (passed:true)` then synthesize. The corrective prompt is visible in the second researcher invocation.

- [ ] **Check 3: Max-attempts throw.** With a deliberately incapable model, the workflow fails after the 3rd refine iteration with the deficits error message — same shape as today's validate failure.

- [ ] **Check 4: Cache stays warm across retries.** During a retry, the researcher's second pass can call `find-in-page` on a URL fetched in the first pass and get a hit. The cache is only cleared on loop exit.

- [ ] **Check 5: Scorers run on synthesizer's output.** Unchanged; verify the five scorer panels in Studio show after a successful run.

---

## Out of scope

- **Quality-based retries.** The gate only counts items; it doesn't judge their quality. If the agent fabricates findings to satisfy counts, retries don't catch that — downstream scorers do, after synthesis.
- **Adaptive retry budget.** MAX_ATTEMPTS is a static constant. A future improvement could scale with the deficit type ("1 more source" needs less budget than "rebuild competitor section").
- **Per-attempt timeout.** Each retry inherits the agent's `maxSteps: 60`. We could shorten retries (e.g. `maxSteps: 30`) since they only need to fill gaps, but the simpler design defers this until we observe real run profiles.
- **Synthesizer retries.** If the synthesizer produces a low-scoring report, no automatic retry. Manual inspection only.

---

## Risks worth flagging

- **Cost ceiling.** 3 × maxSteps:60 = 180 model+tool calls worst case per workflow run. For a paid model this is real money; the throw at max attempts prevents runaway, but the average cost per failed run is now higher.
- **Mediocre-but-passing retries.** A model that fabricates a 4th trend to satisfy the count could make the gate pass when it shouldn't. The scorers are the next line of defense.
- **Mastra `dountil` semantics confirmation needed.** Per `node_modules/@mastra/core/dist/workflows/workflow.d.ts`, `dountil(step, condition)` runs the step and loops until the condition is true. The condition's shape (`LoopConditionFunction`) — specifically whether it receives `inputData` or some other arg — must be verified by the implementer against the installed version. If the signature differs, adjust the condition function accordingly.
