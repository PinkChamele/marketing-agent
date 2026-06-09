// src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts

import { getCache } from '../../../../modules/page-cache';
import { logger } from '../../../../utils/logger';
import { getErrMsg } from '../../../../utils/errors';

const log = logger.child({ module: 'vertical-entry-cache-cleanup' });

/**
 * Clear the per-run page cache, swallowing failures so a cleanup error
 * never masks the actual workflow result. Used by the research-iteration
 * step on its final-exit paths (passed:true or throw); the retry path
 * intentionally leaves the cache warm so the next iteration can hit it.
 */
export async function clearCache(runId: string): Promise<void> {
  try {
    await getCache().clear(runId);
  } catch (err) {
    log.warn(
      `Failed to clear page cache for run ${runId}: ${getErrMsg(err)} — entries will expire via TTL`,
    );
  }
}
