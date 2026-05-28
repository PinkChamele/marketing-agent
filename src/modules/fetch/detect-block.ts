import { BLOCK_SIGNALS, MIN_REAL_CONTENT } from './constants';
import type { BlockedInfo } from './types';

const test = (text: string, patterns: RegExp[]) => patterns.find((p) => p.test(text));

export function detectBlock(title: string | undefined, markdown: string): BlockedInfo | undefined {
  const haystack = `${title ?? ''}\n${markdown}`;

  for (const { reason, patterns } of BLOCK_SIGNALS) {
    if (title && test(title, patterns)) return { reason, signal: `title:${title}` };

    const bodyMatch = test(haystack, patterns);

    if (bodyMatch && markdown.length < MIN_REAL_CONTENT * 3)
      return { reason, signal: bodyMatch.source };
  }

  return undefined;
}
