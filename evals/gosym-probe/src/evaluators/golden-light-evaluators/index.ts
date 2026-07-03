import type { Evaluator } from '../evaluator.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';

export { createAlignmentLLMEvaluators } from './alignment-llm-evaluators.js';
import { DeterministicDomEvaluator } from './deterministic-dom-evaluator.js';
import { createQualityLLMEvaluators } from './quality-llm-evaluators.js';
import { BinaryCompositeEvaluator } from '../binary-composite-evaluator.js';
import { MeanCompositeEvaluator } from '../mean-composite-evaluator.js';
import type { PassRateEvaluator } from '../binary-composite-evaluator.js';
import type { ScoreModeEvaluator } from '../mean-composite-evaluator.js';
import type { PassRateSpec, ScoreSpec } from './dom-eval-types.js';
import { headingHierarchySpec } from './specs/heading-hierarchy.js';
import { accessibilityCoverageSpec } from './specs/accessibility-coverage.js';
import { linkQualitySpec } from './specs/link-quality.js';
import { responsiveReadinessSpec } from './specs/responsive-readiness.js';
import { responsiveGridCollapseSpec } from './specs/responsive-grid-collapse.js';
import { inlineStyleRatioSpec } from './specs/inline-style-ratio.js';
import { componentDecompositionSpec } from './specs/component-decomposition.js';

const INV_SPECS: PassRateSpec[] = [
  headingHierarchySpec,
  accessibilityCoverageSpec,
  linkQualitySpec,
  responsiveReadinessSpec,
  responsiveGridCollapseSpec,
];

const DIR_SPECS: ScoreSpec[] = [
  inlineStyleRatioSpec,
  componentDecompositionSpec,
];

export function createGoldenLightEvaluators(gocode: IGocodeClient): Evaluator[] {
  const { visualCoherence, contentSubstanceInv, contentSubstanceDir } =
    createQualityLLMEvaluators(gocode);

  const invSubs: PassRateEvaluator[] = [
    ...INV_SPECS.map((spec) => new DeterministicDomEvaluator(spec) as PassRateEvaluator),
    contentSubstanceInv,
  ];

  const dirSubs: ScoreModeEvaluator[] = [
    ...DIR_SPECS.map((spec) => new DeterministicDomEvaluator(spec) as ScoreModeEvaluator),
    visualCoherence as ScoreModeEvaluator,
    contentSubstanceDir as ScoreModeEvaluator,
  ];

  return [
    new BinaryCompositeEvaluator({
      name: 'output-quality-passrate',
      subEvaluators: invSubs,
      evalVersion: '3.0',
    }),
    new MeanCompositeEvaluator({
      name: 'output-quality-scoremode',
      subEvaluators: dirSubs,
      evalVersion: '3.0',
    }),
  ];
}
