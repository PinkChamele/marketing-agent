Implement a per-run cache for fetched page content, and add a `findInPage`
tool that lets the research agent search within previously fetched pages
without re-fetching or re-running web searches.

# Context

I have a Mastra agent for vertical-entry research. The agent uses a fetch tool
to retrieve web pages, which returns clean markdown. Currently, once a page is
fetched, its content lives only in the agent's conversation context. If the
agent wants to find a specific phrase in a page it already fetched earlier in
the run, it has no way to do that directly — it either burns input tokens
re-reading the whole page from context, or falls back to a new web search to
relocate a quote it knows is already in a page it has.

This change adds a per-run content cache and a tool to query it.

# Before writing any code

1. Load the `mastra` skill from node_modules to verify the current tool API,
   memory API, storage API, and workflow execution context shape against the
   installed Mastra version.
2. Explore the repository to understand the existing shapes you'll be
   extending: the fetch module and its provider chain, the existing fetch
   tool wrapper, the storage configuration, the researcher agent, the
   workflow that invokes it, and how tools are registered. Confirm your
   understanding of how runId / resource scoping flows through tool calls
   in this codebase before committing to an approach.

Do not start writing until you have read enough of the codebase to be
confident about API shapes and conventions.

# Requirements

## 1. Per-run cache for fetched content

The cache stores markdown keyed by URL within the scope of a single workflow
run. Two URLs fetched in different runs must not collide; two fetches of the
same URL within one run should hit the cache on the second call.

Constraints:
- Scope cache entries by the same identifier used as Mastra's memory resource
  for the run (the runId).
- Use Mastra's existing storage layer. Do NOT add a new external dependency.
  If the storage layer doesn't natively support arbitrary KV by run, store
  cache entries in a dedicated table/store using whatever pattern Mastra's
  storage supports for non-memory data. Verify against the skill docs.
- Each cache entry contains at minimum: the requested URL, the final URL
  (after redirects), the markdown content, an optional title, a fetchedAt
  timestamp, and a sizeBytes field.
- Size limit per entry: 500KB of markdown (about ~120k tokens). If a fetched
  page exceeds this, store the first 500KB and add a `truncated: true` flag
  to the entry.
- TTL: entries auto-expire 24 hours after fetchedAt, AND get explicitly
  cleared at the end of the workflow run. Implement both — TTL as a safety
  net, explicit clear on workflow completion as the normal path.

The cache implementation should live behind a small interface (get, set,
list, clear, all scoped by runId) so the storage backend is swappable later.
This follows the existing provider-interface pattern used elsewhere in the
codebase.

## 2. Integrate the cache into the existing fetch flow

Modify the public fetch entry point to:

- Accept a runId parameter (required — not optional; the contract should
  force callers to scope fetches to a run).
- Before calling any provider, check the cache. If a hit exists, return it
  with a marker on the result indicating it came from cache (e.g., a source
  field set to "cache").
- After a successful provider fetch, write the result to the cache before
  returning.
- Cache hits must NOT count as provider calls (don't trigger the provider
  chain, retries, or fallback logic).

## 3. Add the `findInPage` tool

Input schema (Zod):
- runId — UUID
- url — the URL to search within
- query — text fragment to find. Plain text, case-insensitive. The description
  should tell the agent: "For finding multiple distinct phrases, call the tool
  once per phrase."
- contextChars — integer, 50–2000, default 300. Characters of surrounding
  context to return with each match.
- maxMatches — integer, 1–20, default 5. Maximum number of matches to return.

Output schema (Zod):
- found — boolean
- matches — array of { snippet (the match with surrounding context),
  matchOffset (where the match starts in the markdown) }
- pageMetadata — optional, containing title, finalUrl, fetchedAt, truncated
- error — optional string, e.g., "URL not in cache for this run"

Behavior:

- Look up the URL in the cache for the given runId. If not present, return
  `{ found: false, error: "URL not previously fetched in this run. Use the
  fetch tool first." }`. Do NOT silently fall back to fetching — that would
  mask the agent's mistake and burn a fetch credit.
- If present, perform case-insensitive substring matching of the query in
  the cached markdown. Return up to maxMatches matches, each with
  contextChars/2 characters before and after the match.
- If the query yields no matches but the URL was cached, return
  `{ found: false, matches: [], pageMetadata: {...} }`. This is a meaningful
  distinct result from "URL not cached" — it tells the agent "the phrase
  isn't there" rather than "you need to fetch first."

Tool description (what the agent reads to know when to use it):

Search for a specific phrase or quote within a page you have already
fetched in this research run. Use this instead of re-fetching the page or
running a new web search when you remember that a fetched page contains a
specific fact, quote, or number, and you need to locate it precisely or
verify its surrounding context.
You MUST have already fetched this URL in the current run. The tool will
not fetch new pages.
Typical use: after fetching a long page, use findInPage with the specific
phrase you need to extract for evidence.

## 4. Update the existing fetch tool

- Ensure the fetch tool's input schema includes a required runId field if it
  doesn't already.
- Pass runId through to the underlying fetch entry point.
- Extend the tool's description to mention: "After fetching a page, you can
  later search within it without re-fetching by calling findInPage with the
  same URL and your current runId."

## 5. Wire up cache lifecycle in the workflow

- After the researcher step completes, clear the cache for that runId. The
  synthesizer doesn't need fetched-page access (it works from working
  memory), so the cache can be released after research.
- If the workflow errors, still attempt to clear the cache in a finally-style
  cleanup. Don't let cache entries leak on failed runs.

## 6. Register the new tool

Register findInPage alongside the existing tools, and add it to the
researcher agent's toolset. The synthesizer agent does NOT get this tool.

# What NOT to do

- Do NOT add a new external dependency. Use Mastra's existing storage layer.
- Do NOT introduce vector embeddings or semantic search. This is exact-match
  substring search by design — the agent uses it to relocate phrases it
  already knows the wording of.
- Do NOT make the cache cross-run. Cache scoping is per-runId by design.
- Do NOT make findInPage fall through to the fetch tool on a cache miss.
  The agent should learn to fetch first; silent fallthrough hides bugs and
  costs credits.
- Do NOT change the existing fetch provider chain behavior, retries, or
  fallback logic. The cache is an additional layer before the chain, not a
  replacement.
- Do NOT modify the synthesizer agent or its tools. The cache and findInPage
  are researcher-side concerns only.

# Boundaries

- Load the `mastra` skill before any Mastra API decisions.
- Use Zod schemas for all tool inputs and outputs.
- Verify schema field names and the runId-passing convention against the
  installed Mastra version (this has varied between releases — confirm
  whether tools receive runId via tool input or via execution context).
- Run the build to verify everything compiles before finishing.
- Add brief inline comments only where the reasoning isn't obvious from
  the code.

# Acceptance criteria

When you're done, the following should be true:

1. A workflow run that fetches URL X, then later calls findInPage on URL X
   with a query that appears in the page, returns the match with context —
   no additional HTTP requests made.
2. Calling findInPage on a URL that hasn't been fetched in the current run
   returns the structured `{ found: false, error: "..." }` response, not
   an exception or a silent fetch.
3. Fetching the same URL twice in the same run results in one provider
   call and one cache hit (verifiable in logs).
4. After the researcher step completes (success or error), the cache for
   that runId is empty.
5. The build passes.
6. The existing eval harness still runs without errors (you don't need to
   verify scorer outputs improve — that's separate).

# When you're done

Report back with:
- A short summary of what changed (files modified, files added).
- Any places where the existing API shape required you to deviate from
  this spec, with the reason.
- Any concerns about the implementation worth raising before merging.
- Confirmation that the build passes, plus a sample log line showing a
  cache hit working end-to-end if you can produce one.
