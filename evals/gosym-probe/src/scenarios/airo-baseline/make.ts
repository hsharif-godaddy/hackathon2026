import type { AABCtrlPlaneClient } from '../../clients/aab-ctrl-plane-client.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { Scenario } from '../types.js';
import { buildAiroBaselineScenarioById } from './scenario-factory.js';

export type AiroBaselineScenarioBuilder = (
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
) => Scenario;

export function makeAiroBaselineScenario(
  syntheticId: string,
): AiroBaselineScenarioBuilder {
  return function build(gocode, ctrlPlane) {
    return buildAiroBaselineScenarioById(syntheticId, gocode, ctrlPlane);
  };
}
