import { tavily, type TavilyClient, type TavilyClientOptions } from '@tavily/core';
import { SearchProviderName } from '../enums/provider.enum';
import type { SearchProvider, SearchQuery, SearchResult } from '../types';

type TavilySearchResult = Awaited<ReturnType<TavilyClient['search']>>['results'][number];

const toDomainResult = (result: TavilySearchResult): SearchResult => ({
  url: result.url,
  title: result.title,
  snippet: result.content ?? '',
  content: result.rawContent ?? undefined,
});

export class TavilyProvider implements SearchProvider {
  readonly name = SearchProviderName.Tavily;

  private readonly tavily: TavilyClient;

  constructor(config: TavilyClientOptions) {
    this.tavily = tavily(config);
  }

  async search({ query, ...options }: SearchQuery): Promise<SearchResult[]> {
    const { results } = await this.tavily.search(query, options);

    return results.map(toDomainResult);
  }
}
