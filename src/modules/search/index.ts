import { SearchProviderName } from './enums/provider.enum';
import * as Providers from './factory';
import type { SearchQuery, SearchResult } from './types';

export type { SearchQuery, SearchResult, SearchProvider } from './types';

export interface SearchOptions {
  provider?: SearchProviderName;
}

export async function search(
  query: SearchQuery,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const provider = Providers.get(options.provider);

  return provider.search(query);
}

export function init() {
  Providers.init();
}
