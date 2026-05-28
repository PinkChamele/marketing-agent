import { env } from '../../config/env';
import { getDailyModel } from './daily-model';
import type { OpenRouterModel } from './openrouter-model';
import { ModelRole } from './model-role.enum';

export { ModelRole } from './model-role.enum';
export type { OpenRouterModel } from './openrouter-model';
export { openRouterModelSchema } from './openrouter-model';
export { getDailyModel, refreshDailyModel, startDailyModelScheduler } from './daily-model';

type RoleModelMap = Record<ModelRole, OpenRouterModel>;

const DEFAULT_MODELS: RoleModelMap = {
  researcher: 'openrouter/anthropic/claude-sonnet-4.5',
  synthesizer: 'openrouter/anthropic/claude-opus-4.7',
  cheap: 'openrouter/google/gemini-2.5-flash',
};

const OVERRIDES: Partial<RoleModelMap> = {
  researcher: env.MODEL_RESEARCHER,
  synthesizer: env.MODEL_SYNTHESIZER,
  cheap: env.MODEL_CHEAP,
};

export const model = (role: ModelRole) => () =>
  OVERRIDES[role] ?? getDailyModel() ?? DEFAULT_MODELS[role];

export const describeModels = () => {
  const daily = getDailyModel();

  return {
    researcher: OVERRIDES.researcher ?? daily ?? DEFAULT_MODELS.researcher,
    synthesizer: OVERRIDES.synthesizer ?? daily ?? DEFAULT_MODELS.synthesizer,
    cheap: OVERRIDES.cheap ?? daily ?? DEFAULT_MODELS.cheap,
  };
};
