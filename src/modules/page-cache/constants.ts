export const MAX_ENTRY_BYTES = 500 * 1024; // 500KB cap per cached page (~120k tokens)
export const TTL_MS = 24 * 60 * 60 * 1000; // 24h safety-net expiry on top of explicit clear
export const TABLE_NAME = 'page_cache';
export const DB_FILE = 'file:./mastra-cache.db';
