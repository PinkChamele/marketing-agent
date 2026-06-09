import z from 'zod';
import { createTool } from '@mastra/core/tools';
import { fetchUrl } from '../../modules/fetch';
import { BlockReason } from '../../modules/fetch';
import { extractSections } from '../../modules/extract-sections';

const descriptions = {
  tool:
    'Fetch a single web page and return its main content as a list of sections (heading + content). Use this after `web-search` when you need the full text of a result rather than just the snippet, or when an agent already has a known URL (e.g. a competitor homepage, a 10-K, an analyst report). Providers are tried in order — cheap HTTP+readability first, then Firecrawl for JS-heavy pages — so calls are best-effort and may return empty/short content for paywalls, bot walls, or dynamic apps. Scan section headings first; read the content of sections you care about. For very large pages, sections give you a structured view without loading the whole document. To search for a specific phrase inside a page you have already fetched, use `find-in-page` instead of re-fetching.',
  input: {
    url: 'Absolute URL of the page to fetch. Must be a fully qualified http(s) URL.',
    requiresJs:
      'Hint that the page is JS-heavy (an SPA, dashboard, or paywalled article) and cheap providers will likely fail. Set true to skip straight to the JS-capable provider; leave omitted to let the chain decide.',
  },
  output: {
    url: 'The URL that was requested.',
    finalUrl: 'The resolved URL after any redirects. May differ from `url`.',
    title: 'Page title, when the provider could extract one.',
    sections:
      'Array of `{ heading, level, content, contentChars, truncated }` parsed from the page markdown. Headings preserve the markdown depth (1-6). Content before the first heading is a preamble section with `heading: null, level: 0`. Pages with no headings produce one preamble section containing the whole page. Sections over 30k chars are truncated; the truncated flag is set on those. The full original markdown is in the cache — use `find-in-page` to search within a previously fetched URL.',
    pageChars: 'Total chars of the source markdown — useful to gauge page size before scanning every section.',
    source: 'Name of the provider that produced this result (e.g. "firecrawl", "cache"). Useful for logs.',
    fetchedAt: 'ISO 8601 timestamp of when the fetch completed.',
    blocked:
      'Set when the page was reachable but its content was gated (login-wall, paywall, captcha, or cookie-wall). When this is present, the `sections` array is unreliable — do NOT quote from it. Use the search snippet for this URL instead, or move on to another source.',
    blockedReason: 'Which gate was detected.',
    blockedSignal: 'What triggered detection (regex source or "title:..." marker), for debugging.',
  },
} as const;

const sectionSchema = z.object({
  heading: z.string().nullable(),
  level: z.number().int().min(0).max(6),
  content: z.string(),
  contentChars: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const fetchTool = createTool({
  id: 'fetch-url',
  description: descriptions.tool,
  inputSchema: z.object({
    url: z.url().describe(descriptions.input.url),
    requiresJs: z.boolean().optional().describe(descriptions.input.requiresJs),
  }),
  outputSchema: z.object({
    url: z.url().describe(descriptions.output.url),
    finalUrl: z.url().describe(descriptions.output.finalUrl),
    title: z.string().optional().describe(descriptions.output.title),
    sections: z.array(sectionSchema).describe(descriptions.output.sections),
    pageChars: z.number().int().nonnegative().describe(descriptions.output.pageChars),
    source: z.string().describe(descriptions.output.source),
    fetchedAt: z.iso.datetime().describe(descriptions.output.fetchedAt),
    blocked: z
      .object({
        reason: z.enum(BlockReason).describe(descriptions.output.blockedReason),
        signal: z.string().describe(descriptions.output.blockedSignal),
      })
      .optional()
      .describe(descriptions.output.blocked),
  }),
  execute: async ({ url, requiresJs }, { requestContext }) => {
    const runIdValue = requestContext?.get('runId');
    if (!runIdValue || typeof runIdValue !== 'string') {
      throw new Error('runId missing from requestContext — workflow misconfigured');
    }
    const result = await fetchUrl({ url, runId: runIdValue, requiresJs });
    const sections = result.blocked ? [] : extractSections(result.markdown);
    return {
      url: result.url,
      finalUrl: result.finalUrl,
      title: result.title,
      sections,
      pageChars: result.markdown.length,
      source: result.source,
      fetchedAt: result.fetchedAt,
      blocked: result.blocked,
    };
  },
});
