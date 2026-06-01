/**
 * Matches http(s) URLs found in a report. Excludes whitespace and common
 * surrounding punctuation (parens, brackets, CJK brackets, quotes, angle
 * brackets) so a citation like `(https://x.com)` parses to `https://x.com`
 * cleanly.
 */
const URL_REGEX = /https?:\/\/[^\s)\]】"'<>]+/g;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  return matches.map((u) => u.replace(/[.,;]+$/, ''));
}

export function extractDomains(text: string): string[] {
  const domains = extractUrls(text)
    .map((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  return [...new Set(domains)];
}

/**
 * Mastra always invokes `.analyze` when defined — we can't skip the judge
 * call on incomplete runs, but we can make it tiny. Returns a prompt that
 * asks the model to echo a fixed empty-shape JSON, costing ~30-50 tokens
 * instead of the full ~3000-token analysis prompt.
 */
export function buildSkipPrompt(emptyShape: object): string {
  return `Respond with exactly this JSON and nothing else:\n${JSON.stringify(emptyShape)}`;
}
