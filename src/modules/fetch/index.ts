import { SUSPICIOUSLY_SHORT_THRESHOLD } from "./constants";
import { FetchError } from "./error";
import * as Factory from "./factory";
import type { FetchRequest } from "./types";

export type { FetchRequest, FetchResult, FetchProvider } from "./types";

export async function fetchUrl(request: FetchRequest) {
  const chain = Factory.getChain();
  const errors: FetchError[] = [];

  for (const provider of chain) {
    if (!provider.canHandle(request)) continue;

    try {
      const result = await provider.fetch(request);
      const isLast = provider === chain[chain.length - 1];

      if (!isLast && result.markdown.length < SUSPICIOUSLY_SHORT_THRESHOLD) {
        continue;
      }

      return result;
    } catch (err) {
      if (err instanceof FetchError) {
        errors.push(err);
        continue;
      }
      throw err;
    }
  }

  throw new FetchError(
    `All fetch providers failed for ${request.url}: ` +
      errors.map((e) => `[${e.provider}] ${e.message}`).join("; "),
    request.url,
    "chain",
  );
}

export function init() {
  Factory.init();
}
