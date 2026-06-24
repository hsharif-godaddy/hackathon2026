import type { Evaluator } from '../evaluator.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';

export { createAlignmentLLMEvaluators } from './alignment-llm-evaluators.js';
import { CompositeEvaluator } from '../composite-evaluator.js';
import { DeterministicDomEvaluator } from './deterministic-dom-evaluator.js';
import { createQualityLLMEvaluators } from './quality-llm-evaluators.js';
import { headingHierarchySpec } from './specs/heading-hierarchy.js';
import { semanticDensitySpec } from './specs/semantic-density.js';
import { accessibilityCoverageSpec } from './specs/accessibility-coverage.js';
import { linkQualitySpec } from './specs/link-quality.js';
import { responsiveReadinessSpec } from './specs/responsive-readiness.js';
import { responsiveGridCollapseSpec } from './specs/responsive-grid-collapse.js';
import { inlineStyleRatioSpec } from './specs/inline-style-ratio.js';
import { componentDecompositionSpec } from './specs/component-decomposition.js';

const DETERMINISTIC_SPECS = [
  headingHierarchySpec,
  semanticDensitySpec,
  accessibilityCoverageSpec,
  linkQualitySpec,
  responsiveReadinessSpec,
  responsiveGridCollapseSpec,
  inlineStyleRatioSpec,
  componentDecompositionSpec,
];

export function createGoldenLightEvaluators(gocode: IGocodeClient): Evaluator[] {
  const deterministicEvaluators = DETERMINISTIC_SPECS.map(
    (spec) => new DeterministicDomEvaluator(spec),
  );
  const subEvaluators = [
    ...deterministicEvaluators,
    ...createQualityLLMEvaluators(gocode),
  ];
  return [
    new CompositeEvaluator({
      name: 'output-quality',
      subEvaluators,
      regressionMode: 'score',
    }),
  ];
}
