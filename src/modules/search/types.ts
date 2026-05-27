import type { SearchProviderName } from './enums/provider.enum';

export interface SearchQuery {
  query: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  maxResults?: number;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  content?: string;
}

export interface SearchProvider {
  readonly name: SearchProviderName;

  search(query: SearchQuery): Promise<SearchResult[]>;
}
