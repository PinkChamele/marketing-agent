import { DB_FILE } from './constants';
import { LibSqlPageCache } from './libsql';
import type { PageCache } from './types';

export type { PageCache, PageCacheEntry } from './types';
export { MAX_ENTRY_BYTES, TTL_MS } from './constants';

let cache: PageCache | null = null;

export async function init(): Promise<void> {
  if (cache) return;
  cache = await LibSqlPageCache.create(DB_FILE);
}

export function getCache(): PageCache {
  if (!cache) {
    throw new Error('Page cache not initialized — call init() at startup');
  }
  return cache;
}
