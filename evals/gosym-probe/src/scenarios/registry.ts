import { buildAiroBaselineScenarios } from './airo-baseline/index.js';
import {
  cleaningBizAmbiguityScenario,
  multipageCatalogScenario,
  simplePortfolioScenario,
} from './golden-light/index.js';
import { buildWithExplicitNameScenario } from './todo-lifecycle/build-with-explicit-name.js';
import { reAskInToolCallScenario } from './todo-lifecycle/re-ask-in-tool-call.js';
import { buildLandingPageScenario } from './build-landing-page.js';
import {
  complexPromptLatencyScenario,
} from './complex-prompt-latency.js';
import { brandLogoScenario } from './brand-logo.js';
import {
  handoffVoiceHandbackScenario,
  handoffVoiceSeoCheckScenario,
} from './handoff-voice/index.js';
import {
  symptomBlankPageScenario,
  symptomChangesNotShowingScenario,
  symptomModuleNotFoundScenario,
  multiTurnPublishFlowScenario,
} from './prompt-vs-skill/index.js';
import { buildPortfolioPromptTaxScenarios } from './prompt-tax/index.js';
import { buildCookieConsentGtmScenario } from './cookie-consent-gtm.js';
import {
  addUserTableScenario,
  crudApiHandlerScenario,
  noReturningScenario,
  foreignKeyRelationshipScenario,
  noRawSqlClientScenario,
  schemaEvolutionScenario,
} from './skills/database/index.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type {
  AABCtrlPlaneClient,
} from '../clients/aab-ctrl-plane-client.js';
import type { Config } from '../../config/environments/types.js';
import type { Scenario } from './types.js';

export function createAllScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario[] {
  return [
    simplePortfolioScenario(gocode, ctrlPlane),
    buildWithExplicitNameScenario(gocode, ctrlPlane),
    reAskInToolCallScenario(gocode, ctrlPlane),
    multipageCatalogScenario(gocode, ctrlPlane),
    cleaningBizAmbiguityScenario(gocode, ctrlPlane),
    buildLandingPageScenario(gocode, ctrlPlane, config),
    symptomBlankPageScenario(gocode, ctrlPlane),
    symptomChangesNotShowingScenario(gocode, ctrlPlane),
    symptomModuleNotFoundScenario(gocode, ctrlPlane),
    multiTurnPublishFlowScenario(gocode, ctrlPlane),
    complexPromptLatencyScenario(gocode, ctrlPlane),
    brandLogoScenario(gocode, ctrlPlane),
    handoffVoiceSeoCheckScenario(gocode, ctrlPlane),
    handoffVoiceHandbackScenario(gocode, ctrlPlane),
    buildCookieConsentGtmScenario(gocode, ctrlPlane),
    ...buildAiroBaselineScenarios(gocode, ctrlPlane),
    ...buildPortfolioPromptTaxScenarios(gocode, ctrlPlane),
    addUserTableScenario(gocode, ctrlPlane),
    crudApiHandlerScenario(gocode, ctrlPlane),
    noReturningScenario(gocode, ctrlPlane),
    foreignKeyRelationshipScenario(gocode, ctrlPlane),
    noRawSqlClientScenario(gocode, ctrlPlane),
    schemaEvolutionScenario(gocode, ctrlPlane),
  ];
}
