import type { Evaluator } from '../evaluator.js';
import type { GocodeClient } from '../../clients/gocode-client.js';

import { createBaselineLLMEvaluators } from './baseline-llm-evaluators.js';
import {
  HeroSectionPresenceEvaluator,
  NavigationPresenceEvaluator,
  PrimaryCtaPresenceEvaluator,
} from './structure-checks.js';
import { TotalTimeTakenEvaluator } from './operational-efficiency.js';

export function createBaselineEvaluators(gocode: GocodeClient): Evaluator[] {
  return [
    ...createBaselineLLMEvaluators(gocode),
    new TotalTimeTakenEvaluator(),
    new HeroSectionPresenceEvaluator(),
    new NavigationPresenceEvaluator(),
    new PrimaryCtaPresenceEvaluator(),
  ];
}

export { createBaselineLLMEvaluators } from './baseline-llm-evaluators.js';
export {
  HeroSectionPresenceEvaluator,
  NavigationPresenceEvaluator,
  PrimaryCtaPresenceEvaluator,
} from './structure-checks.js';
export { TotalTimeTakenEvaluator } from './operational-efficiency.js';
