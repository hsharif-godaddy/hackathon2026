export {
  BaseEvaluator,
  registerEvaluator,
  createEvaluator,
  getRegisteredEvaluators,
  DEFAULT_CONCURRENCY,
  type EvaluatorConfig,
  type EvaluatorResult,
  type EvaluatorFactory,
} from './base-evaluator.js';

export { AssessmentEvaluator } from './assessment-evaluator.js';

// Auto-register evaluators by importing them
import './assessment-evaluator.js';
