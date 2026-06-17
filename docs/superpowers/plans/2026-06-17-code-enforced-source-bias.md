# Code-enforced source-bias (exclude) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Always filter known SEO/vendor-marketing domains out of every web search in code (not just via the researcher prompt), and fix the `everestgroup.com` → `everestgrp.com` domain bug.

**Architecture:** Add a `DEFAULT_EXCLUDE_DOMAINS` constant plus a pure `withDefaultExcludes(query)` helper in the search module's `domain-presets.ts`, and apply it inside `search()` (the single chokepoint every web-search tool call passes through). Then trim the now-redundant exclude list from the researcher prompt and fix the analyst-firm domain typo.

**Tech Stack:** TypeScript (ES2022, strict), Mastra `@mastra/core` tools, Exa search provider, Zod.

**Spec:** `docs/superpowers/specs/2026-06-17-code-enforced-source-bias-design.md`

**Testing note:** No unit-test harness (`npm test` is a stub — backlog A4); unit tests are out of scope per spec. Verification per task is `npx tsc --noEmit` + `npm run build`. Behavioral confirmation happens on the next end-to-end run (not part of this plan's commits).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/modules/search/domain-presets.ts` | Default denylist + pure merge helper | Modify — add `DEFAULT_EXCLUDE_DOMAINS`, `withDefaultExcludes`, widen the type import |
| `src/modules/search/index.ts` | Search chokepoint | Modify — apply `withDefaultExcludes` before dispatching to the provider |
| `src/mastra/agents/researcher.ts` | Researcher agent prompt | Modify — fix `everestgrp.com`; remove the now-automatic "Always exclude" section |

No new files. No interface/type changes to `SearchProvider` or `SearchQuery`.

---

## Task 1: Add the default denylist and merge helper

**Files:**
- Modify: `src/modules/search/domain-presets.ts`

The file currently imports only `SearchResult` from `./types` and exports the gated-URL helpers. Add the default-exclude constant and a pure merge helper alongside them; the gated-URL code is untouched.

- [ ] **Step 1: Widen the type import**

Replace this exact line (line 1):

```ts
import type { SearchResult } from './types';
```

with:

```ts
import type { SearchQuery, SearchResult } from './types';
```

- [ ] **Step 2: Append the constant and helper**

Append to the end of `src/modules/search/domain-presets.ts`:

```ts

/**
 * Domains always excluded from web search, regardless of what the agent passes.
 * SEO market-report vendors and vendor-marketing / "best-of" listicle sites whose
 * content is low-signal for grounded market research. Enforced in code (not just
 * the researcher prompt) so a search that omits `excludeDomains` is still filtered.
 * Transferred 1:1 from the researcher prompt's former "Always exclude" section.
 */
export const DEFAULT_EXCLUDE_DOMAINS = [
  // SEO market-report vendors
  'imarcgroup.com',
  'market.us',
  'sphericalinsights.com',
  'snsinsider.com',
  'grandviewresearch.com',
  'mordorintelligence.com',
  'marketsandmarkets.com',
  'precedenceresearch.com',
  'fortunebusinessinsights.com',
  // Vendor-marketing pages and "best-of" listicles
  'sumatosoft.com',
  'belitsoft.com',
  'dashtech.io',
  'softwareexpertsindia.com',
  'clutch.co',
  'goodfirms.co',
  'designrush.com',
  'techbehemoths.com',
] as const;

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/^www\./, '');

/**
 * Returns a copy of the query whose `excludeDomains` is the union of the agent's
 * excludes and DEFAULT_EXCLUDE_DOMAINS — normalized (lowercased, `www.` stripped)
 * and de-duplicated. `includeDomains` and all other fields are untouched.
 */
export const withDefaultExcludes = (query: SearchQuery): SearchQuery => {
  const merged = [...(query.excludeDomains ?? []), ...DEFAULT_EXCLUDE_DOMAINS].map(normalizeHost);

  return { ...query, excludeDomains: [...new Set(merged)] };
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. (If it reports `SearchQuery` unused, it means Step 2 was skipped — the helper signature uses it.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/search/domain-presets.ts
git commit -m "feat(search): add code-enforced default exclude-domain denylist"
```

---

## Task 2: Apply the merge in the search chokepoint

**Files:**
- Modify: `src/modules/search/index.ts`

`search()` is the single function every `web-search` tool call routes through. Apply the merge to the query before dispatching to the provider; `deprioritizeGated` on the results is unchanged.

- [ ] **Step 1: Import the helper**

Replace this exact line (line 3):

```ts
import { deprioritizeGated } from './domain-presets';
```

with:

```ts
import { deprioritizeGated, withDefaultExcludes } from './domain-presets';
```

- [ ] **Step 2: Apply the merge before dispatch**

Replace this exact block:

```ts
  const provider = Providers.get(options.provider);
  const results = await provider.search(query);

  return deprioritizeGated(results);
```

with:

```ts
  const provider = Providers.get(options.provider);
  const results = await provider.search(withDefaultExcludes(query));

  return deprioritizeGated(results);
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/search/index.ts
git commit -m "feat(search): always merge default excludes into every search query"
```

---

## Task 3: Fix the analyst domain and drop the redundant prompt section

**Files:**
- Modify: `src/mastra/agents/researcher.ts`

Two prompt edits. The exclude list is now enforced in code, so the prompt no longer needs to restate it (avoids drift between prompt and code); the `includeDomains` "Strongly prefer" section stays.

- [ ] **Step 1: Fix the Everest Group domain**

In the "Analyst firms" line, `everestgroup.com` is a 1996-era India staffing site; the analyst firm is `everestgrp.com` (already used correctly elsewhere in the file).

Replace this exact text:

```
    everestgroup.com, hfsresearch.com
```

with:

```
    everestgrp.com, hfsresearch.com
```

- [ ] **Step 2: Replace the "Always exclude" section**

Replace this exact block:

```
**Always exclude** (pass in \`excludeDomains\` on every search):

  - SEO market-report vendors: imarcgroup.com, market.us, sphericalinsights.com,
    snsinsider.com, grandviewresearch.com, mordorintelligence.com,
    marketsandmarkets.com, precedenceresearch.com, fortunebusinessinsights.com
  - Vendor-marketing pages and "best-of" listicles: sumatosoft.com,
    belitsoft.com, dashtech.io, softwareexpertsindia.com, clutch.co,
    goodfirms.co, designrush.com, techbehemoths.com
```

with:

```
Low-signal sources (SEO market-report vendors, vendor-marketing
"best-of" listicles) are filtered out of every search automatically —
you do not need to list them in \`excludeDomains\`.
```

(The `\`` escapes are literal in the source template literal; preserve them exactly as shown.)

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Verify the prompt body still reads correctly**

Read `src/mastra/agents/researcher.ts` around the "Source bias" section and confirm: the "Strongly prefer" / `includeDomains` block is intact, `everestgrp.com` is correct, and the old SEO/vendor bullet lists are gone, replaced by the single automatic-filtering sentence.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/researcher.ts
git commit -m "fix(researcher): correct Everest Group domain; drop now-automatic exclude list"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean build and tree**

Run: `npx tsc --noEmit && npm run build && git status --short`
Expected: both commands exit 0; `git status --short` prints nothing.

- [ ] **Step 2: Record the behavioral check (no code)**

The runtime confirmation is the next end-to-end run, NOT part of this plan:
domains in `DEFAULT_EXCLUDE_DOMAINS` must not appear in search results even when
the agent passes no `excludeDomains`. Per spec, the elevancesystems-class leak is
explicitly NOT expected to be fixed by this change (denylist completeness is out
of scope).

- [ ] **Step 3: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- `DEFAULT_EXCLUDE_DOMAINS` constant, 1:1 from prompt → Task 1 Step 2. ✓
- `withDefaultExcludes` pure helper (union, normalize, dedup, `includeDomains` untouched) → Task 1 Step 2. ✓
- Applied in `search()` chokepoint → Task 2. ✓
- `everestgroup.com` → `everestgrp.com` → Task 3 Step 1. ✓
- Remove the "Always exclude" prompt section; keep "Strongly prefer" → Task 3 Step 2. ✓
- Out of scope (include-enforce, post-filter, denylist expansion) → absent from all tasks. ✓
- Verification = tsc/build + next-run behavioral note → Task 1/2/3 type-check steps + Task 4. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows exact old/new text. ✓

**Type consistency:** `withDefaultExcludes(query: SearchQuery): SearchQuery` defined in Task 1 and called with the same name/signature in Task 2. `DEFAULT_EXCLUDE_DOMAINS` defined Task 1, referenced only inside the helper. Import widened (`SearchQuery`) before use. ✓
