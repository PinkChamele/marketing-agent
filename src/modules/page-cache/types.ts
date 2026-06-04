export interface PageCacheEntry {
  runId: string;
  url: string;
  finalUrl: string;
  markdown: string;
  title?: string;
  fetchedAt: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface PageCache {
  get(runId: string, url: string): Promise<PageCacheEntry | null>;
  set(entry: PageCacheEntry): Promise<void>;
  list(runId: string): Promise<PageCacheEntry[]>;
  clear(runId: string): Promise<void>;
}
