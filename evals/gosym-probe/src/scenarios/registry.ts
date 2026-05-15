import { buildAiroBaselineScenarios } from './airo-baseline/index.js';
import {
  businessSiteScenario,
  cleaningBizAmbiguityScenario,
  multipageCatalogScenario,
  simplePortfolioScenario,
} from './golden-light/index.js';
import { buildLandingPageScenario } from './build-landing-page.js';
import {
  complexPromptLatencyScenario,
} from './complex-prompt-latency.js';
import {
  symptomBlankPageScenario,
  symptomChangesNotShowingScenario,
  symptomModuleNotFoundScenario,
  multiTurnPublishFlowScenario,
} from './prompt-vs-skill/index.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type {
  AABCtrlPlaneClient,
} from '../clients/aab-ctrl-plane-client.js';
import type { Scenario } from './types.js';

export function createAllScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  return [
    simplePortfolioScenario(gocode, ctrlPlane),
    businessSiteScenario(gocode, ctrlPlane),
    multipageCatalogScenario(gocode, ctrlPlane),
    cleaningBizAmbiguityScenario(gocode, ctrlPlane),
    buildLandingPageScenario(gocode, ctrlPlane),
    symptomBlankPageScenario(gocode, ctrlPlane),
    symptomChangesNotShowingScenario(gocode, ctrlPlane),
    symptomModuleNotFoundScenario(gocode, ctrlPlane),
    multiTurnPublishFlowScenario(gocode, ctrlPlane),
    complexPromptLatencyScenario(gocode, ctrlPlane),
    ...buildAiroBaselineScenarios(gocode, ctrlPlane),
  ];
}
