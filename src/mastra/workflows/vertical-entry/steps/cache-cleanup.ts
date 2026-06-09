// src/mastra/workflows/vertical-entry/steps/cache-cleanup.ts

import { getCache } from '../../../../modules/page-cache';
import { logger } from '../../../../utils/logger';
import { getErrMsg } from '../../../../utils/errors';

const log = logger.child({ module: 'vertical-entry-cache-cleanup' });

/**
 * Clear the per-run page cache, swallowing failures so a cleanup error
 * never masks the actual workflow result. Used by both the initial
 * research step (on throw) and refine-or-pass (on every exit path).
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
