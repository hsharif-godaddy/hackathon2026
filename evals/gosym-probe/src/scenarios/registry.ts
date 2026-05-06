import {
  businessSiteScenario,
  multipageCatalogScenario,
  simplePortfolioScenario,
} from './build-quality/index.js';
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
import type { GocodeClient } from '../clients/gocode-client.js';
import type {
  AABCtrlPlaneClient,
} from '../clients/aab-ctrl-plane-client.js';
import type { Scenario } from './types.js';

export function createAllScenarios(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  return [
    simplePortfolioScenario(gocode, ctrlPlane),
    businessSiteScenario(gocode, ctrlPlane),
    multipageCatalogScenario(gocode, ctrlPlane),
    buildLandingPageScenario(gocode, ctrlPlane),
    symptomBlankPageScenario(gocode, ctrlPlane),
    symptomChangesNotShowingScenario(gocode, ctrlPlane),
    symptomModuleNotFoundScenario(gocode, ctrlPlane),
    multiTurnPublishFlowScenario(gocode, ctrlPlane),
    complexPromptLatencyScenario(gocode, ctrlPlane),
  ];
}
