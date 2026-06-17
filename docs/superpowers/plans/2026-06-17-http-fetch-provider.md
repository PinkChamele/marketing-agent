# Own HTTP + Readability Fetch Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an own HTML fetch provider (HTTP → Readability → markdown) so the system fetches and cleans pages without a Firecrawl account.

**Architecture:** A new `HttpReadabilityProvider` implements the existing `FetchProvider` interface and is placed first in the provider chain; Firecrawl stays as an optional fallback. Node's global `fetch` gets the HTML, `linkedom` parses it, `@mozilla/readability` extracts the main article, `turndown` converts it to markdown. Cache, block detection, and short-content fallback already live above the provider in `index.ts` and are untouched.

**Tech Stack:** TypeScript (ES2022, strict, no DOM lib), Node 22 global `fetch`, `@mozilla/readability`, `linkedom`, `turndown`.

**Spec:** `docs/superpowers/specs/2026-06-17-http-fetch-provider-design.md`

**Testing note:** This repo has no unit-test harness (`npm test` is a stub — backlog A4), and the spec puts unit tests out of scope. Verification uses `npx tsc --noEmit` and `npm run build`, plus a one-off manual smoke (Task 5) that is NOT committed. The casts and global-fetch typings in Task 3 were pre-verified to compile under the project's tsconfig (no DOM lib).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/modules/fetch/providers/http-readability.provider.ts` | `HttpReadabilityProvider` — `FetchRequest` → `FetchResult` via fetch + Readability + turndown | Create |
| `src/modules/fetch/enums/provider-name.enum.ts` | Provider name enum | Modify (add `HttpReadability`) |
| `src/modules/fetch/constants.ts` | Shared fetch constants | Modify (add `USER_AGENT`, `MAX_HTML_CHARS`) |
| `src/modules/fetch/factory.ts` | Build the provider chain from env | Modify (own first, Firecrawl optional) |
| `src/config/env.ts` | Env validation | Modify (`FIRECRAWL_API_KEY` → optional) |
| `.env.example` | Operator env template | Modify |
| `package.json` / `package-lock.json` | New dependencies | Already installed on branch |

---

## Task 1: Dependencies and provider-name enum

**Files:**
- Modify: `src/modules/fetch/enums/provider-name.enum.ts`
- Modify: `package.json` (verify only)

- [ ] **Step 1: Verify the dependencies are installed**

Run: `node -e "require('@mozilla/readability'); require('linkedom'); require('turndown'); console.log('ok')"`
Expected: prints `ok`. If it errors, run `npm install @mozilla/readability linkedom turndown && npm install -D @types/turndown`.

- [ ] **Step 2: Add the enum member**

Edit `src/modules/fetch/enums/provider-name.enum.ts` to read exactly:

```ts
export enum FetchProviderName {
  Firecrawl = 'firecrawl',
  HttpReadability = 'http-readability',
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/modules/fetch/enums/provider-name.enum.ts
git commit -m "chore(fetch): add readability/linkedom/turndown deps and HttpReadability enum"
```

---

## Task 2: Add fetch constants

**Files:**
- Modify: `src/modules/fetch/constants.ts`

- [ ] **Step 1: Add the constants**

At the top of `src/modules/fetch/constants.ts`, after the existing
`DEFAULT_TIMEOUT_MS` line, add:

```ts
/** Sent on every own-provider request; some sites reject empty or bot UAs. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Raw-HTML length cap. Pages longer than this are sliced before parsing to bound CPU. */
export const MAX_HTML_CHARS = 2_000_000;
```

Leave `SUSPICIOUSLY_SHORT_THRESHOLD`, `DEFAULT_TIMEOUT_MS`, `MIN_REAL_CONTENT`, and `BLOCK_SIGNALS` unchanged.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/fetch/constants.ts
git commit -m "feat(fetch): add USER_AGENT and MAX_HTML_CHARS constants"
```

---

## Task 3: Implement `HttpReadabilityProvider`

**Files:**
- Create: `src/modules/fetch/providers/http-readability.provider.ts`

- [ ] **Step 1: Write the provider**

Create `src/modules/fetch/providers/http-readability.provider.ts` with exactly:

```ts
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { FetchRequest, FetchResult, FetchProvider } from '../types';
import { FetchProviderName } from '../enums/provider-name.enum';
import { FetchError } from '../error';
import { DEFAULT_TIMEOUT_MS, USER_AGENT, MAX_HTML_CHARS } from '../constants';
import { getErrMsg } from '../../../utils/errors';

const HTML_CONTENT_TYPE = /text\/html|application\/xhtml\+xml/i;

/**
 * Own fetch provider: HTTP GET → Readability main-content extraction → markdown.
 * HTML only. No JS rendering and no PDF parsing — unsupported pages throw a
 * FetchError so the chain records them as gaps. Caching, block detection, and
 * the short-content fallback live above this provider in `index.ts`.
 */
export class HttpReadabilityProvider implements FetchProvider {
  readonly name = FetchProviderName.HttpReadability;

  private readonly turndown = new TurndownService();

  canHandle(request: FetchRequest) {
    try {
      const { protocol } = new URL(request.url);

      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  async fetch(request: FetchRequest): Promise<FetchResult> {
    let response: Response;

    try {
      response = await fetch(request.url, {
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FetchError(`HTTP request failed: ${getErrMsg(err)}`, request.url, this.name, err);
    }

    if (!response.ok) {
      throw new FetchError(`HTTP ${response.status} ${response.statusText}`, request.url, this.name);
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType && !HTML_CONTENT_TYPE.test(contentType)) {
      throw new FetchError(`Unsupported content-type: ${contentType}`, request.url, this.name);
    }

    const raw = await response.text();
    const html = raw.length > MAX_HTML_CHARS ? raw.slice(0, MAX_HTML_CHARS) : raw;

    const { document } = parseHTML(html);
    // linkedom's document satisfies Readability at runtime; the cast bridges the
    // type gap (tsconfig has no DOM lib, so the `Document` type isn't in scope).
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
    ).parse();

    if (!article?.content?.trim()) {
      throw new FetchError('Readability extracted no content', request.url, this.name);
    }

    const markdown = this.turndown.turndown(article.content).trim();

    if (!markdown) {
      throw new FetchError('Markdown conversion produced empty content', request.url, this.name);
    }

    return {
      url: request.url,
      finalUrl: response.url || request.url,
      title: article.title ?? undefined,
      markdown,
      source: this.name,
      fetchedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. (The file is not imported yet, so this only verifies it compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/fetch/providers/http-readability.provider.ts
git commit -m "feat(fetch): add HttpReadability provider"
```

---

## Task 4: Register the provider and make Firecrawl optional

**Files:**
- Modify: `src/modules/fetch/factory.ts`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Rewrite the factory `init()`**

Replace the entire contents of `src/modules/fetch/factory.ts` with:

```ts
import { env } from '../../config/env';
import type { FetchProvider } from './types';
import { HttpReadabilityProvider } from './providers/http-readability.provider';
import { FirecrawlProvider } from './providers/firecrawl.provider';

let chain: FetchProvider[] | null = null;

export function init() {
  if (chain) return;

  // Own HTTP+Readability provider is always first and needs no API key.
  // Firecrawl is an optional fallback, appended only when its key is set.
  const providers: FetchProvider[] = [new HttpReadabilityProvider()];

  if (env.FIRECRAWL_API_KEY) {
    providers.push(new FirecrawlProvider({ apiKey: env.FIRECRAWL_API_KEY }));
  }

  chain = providers;
}

export function getChain() {
  if (!chain) {
    throw new Error('Fetch providers not initialized — call initFetchProviders() at startup');
  }

  return chain;
}
```

- [ ] **Step 2: Make `FIRECRAWL_API_KEY` optional in `env.ts`**

In `src/config/env.ts`, change:

```ts
  FIRECRAWL_API_KEY: z.string().trim().nonempty(),
```

to:

```ts
  FIRECRAWL_API_KEY: z.string().trim().min(1).optional(),
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/fetch/factory.ts src/config/env.ts
git commit -m "feat(fetch): default to HttpReadability, make Firecrawl optional"
```

---

## Task 5: Update `.env.example` and smoke-test

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update the Firecrawl line in `.env.example`**

In `.env.example`, replace:

```
# Required. JS-page fetch. https://www.firecrawl.dev/app/api-keys
FIRECRAWL_API_KEY=
```

with:

```
# Optional. Fallback fetch provider for JS-heavy pages. The default fetch
# (own HTTP + Readability) needs no key. https://www.firecrawl.dev/app/api-keys
FIRECRAWL_API_KEY=
```

Leave the rest of `.env.example` unchanged.

- [ ] **Step 2: Manual smoke test (NOT committed)**

Create a throwaway file `smoke-fetch.ts` in the repo root:

```ts
import { HttpReadabilityProvider } from './src/modules/fetch/providers/http-readability.provider';

const p = new HttpReadabilityProvider();
for (const url of [
  'https://example.com/',
  'https://en.wikipedia.org/wiki/Outsourcing',
]) {
  try {
    const r = await p.fetch({ url, runId: 'smoke' });
    console.log(`\n=== ${url} ===`);
    console.log('title:', r.title);
    console.log('finalUrl:', r.finalUrl);
    console.log('markdown chars:', r.markdown.length);
    console.log('preview:', r.markdown.slice(0, 200).replace(/\n+/g, ' '));
  } catch (e) {
    console.log(`\n=== ${url} === ERROR:`, e.message);
  }
}
```

Run: `npx -y tsx smoke-fetch.ts` (the repo has no TS runner dependency; `npx -y tsx` fetches one ephemerally — nothing is added to `package.json`). Expected: both URLs print a title and non-trivial `markdown chars` (> 200 for Wikipedia). This confirms end-to-end extraction. If a URL is blocked/unreachable from the sandbox, note it — a network failure here is not a code defect.

Then delete the throwaway file:

```bash
rm smoke-fetch.ts
```

Report the smoke output to the controller. Do NOT commit `smoke-fetch.ts`.

- [ ] **Step 3: Commit the `.env.example` change**

```bash
git add .env.example
git commit -m "docs(env): mark FIRECRAWL_API_KEY optional, own fetch is default"
```

- [ ] **Step 4: Confirm working tree is clean**

Run: `git status --short`
Expected: empty output (the smoke file was deleted, all changes committed).

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0.

- [ ] **Step 2: Read-confirm the chain**

Read `src/modules/fetch/factory.ts` and confirm: with no `FIRECRAWL_API_KEY`,
`init()` produces a chain of exactly `[HttpReadabilityProvider]`; with the key
set, `[HttpReadabilityProvider, FirecrawlProvider]`. Confirm `getChain()` no
longer throws "No fetch providers configured" because the own provider is always
present.

- [ ] **Step 3: No commit** (nothing changed)

---

## Self-Review

**Spec coverage:**
- `HttpReadabilityProvider` (canHandle, fetch flow: request→ok→content-type→cap→parse→readability→turndown→result) → Task 3. ✓
- Throw on `!ok` / non-HTML / empty extraction / empty markdown / network error → Task 3 code. ✓
- `USER_AGENT`, `MAX_HTML_CHARS`, reuse `DEFAULT_TIMEOUT_MS` → Task 2 + Task 3 imports. ✓
- Enum `HttpReadability` → Task 1. ✓
- Factory: own first, Firecrawl optional, defensive guard gone (chain always non-empty) → Task 4 Step 1. ✓
- `FIRECRAWL_API_KEY` optional → Task 4 Step 2. ✓
- `.env.example` Firecrawl demoted to optional → Task 5 Step 1. ✓
- No caching/block-detection/fallback in the provider (lives in index.ts) → Task 3 provider has none. ✓
- Manual smoke, not committed → Task 5 Step 2. ✓
- Out-of-scope (PDF, JS rendering, A2) → absent from all tasks. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. ✓

**Type consistency:** `FetchProviderName.HttpReadability` (Task 1) used in Task 3. `USER_AGENT`/`MAX_HTML_CHARS` (Task 2) imported in Task 3. `HttpReadabilityProvider` constructor takes no args; factory calls `new HttpReadabilityProvider()` (Task 4) — matches. `FetchResult` fields (`url`, `finalUrl`, `title`, `markdown`, `source`, `fetchedAt`) match `src/modules/fetch/types.ts`. The Readability cast and global-fetch typings were pre-verified to compile under the project tsconfig. ✓
