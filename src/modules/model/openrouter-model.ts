import { z } from 'zod';
import { OPENROUTER_MODEL_EXPR, OPENROUTER_PREFIX, OPENROUTER_PREFIX_EXPR } from './constants';

/**
 * Mastra's built-in `openrouter` gateway accepts model IDs in the form
 * `openrouter/<provider>/<model>` (e.g. `openrouter/anthropic/claude-opus-4.7`).
 */
export type OpenRouterModel = `${typeof OPENROUTER_PREFIX}${string}/${string}`;

export const openRouterModelSchema = z
  .string()
  .regex(OPENROUTER_MODEL_EXPR, {
    message: `must look like "${OPENROUTER_PREFIX}<provider>/<model>"`,
  })
  .transform((value) => value as OpenRouterModel);

export const toOpenRouterId = (id: string) =>
  (OPENROUTER_PREFIX + id.replace(OPENROUTER_PREFIX_EXPR, '')) as OpenRouterModel;
