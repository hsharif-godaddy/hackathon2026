import { buildAiroBaselineScenarios } from './airo-baseline/index.js';
import {
  cleaningBizAmbiguityScenario,
  multipageCatalogScenario,
  simplePortfolioScenario,
} from './golden-light/index.js';
import { buildWithExplicitNameScenario } from './todo-lifecycle/build-with-explicit-name.js';
import { reAskInToolCallScenario } from './todo-lifecycle/re-ask-in-tool-call.js';
import { buildLandingPageScenario } from './build-landing-page.js';
import { midConversationIncrementScenario } from './mid-conversation-increment.js';
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
  contactPageExpectationsScenario,
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
import {
  addWelcomeEmailScenario,
  noNodemailerScenario,
  noSenderSpoofingScenario,
  emailWithAttachmentScenario,
  noRecipientFallbackScenario,
  emailOrderConfirmationScenario,
} from './skills/email/index.js';
import { inboxSkillEvalScenario } from './skill-eval/inbox.js';
import { skillNonSelectionScenario } from './skill-eval/skill-non-selection.js';
import { wrongSkillRoutingScenario } from './skill-eval/wrong-skill-routing.js';
import {
  seoNonSelectionScenario,
  googleAnalyticsNonSelectionScenario,
  googleReviewsNonSelectionScenario,
  authenticationNonSelectionScenario,
  onlineAppointmentsNonSelectionScenario,
  commerceVsPaymentRoutingScenario,
} from './skill-eval/index.js';
import {
  addMetaTagsScenario,
  seoAuditFlowScenario,
  noDuplicateTitlesScenario,
  followExistingPatternScenario,
  addStructuredDataScenario,
  registerNewRouteScenario,
} from './skills/seo/index.js';
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
  calibrate: boolean = false,
): Scenario[] {
  return [
    simplePortfolioScenario(gocode, ctrlPlane),
    buildWithExplicitNameScenario(gocode, ctrlPlane),
    reAskInToolCallScenario(gocode, ctrlPlane),
    multipageCatalogScenario(gocode, ctrlPlane, calibrate),
    cleaningBizAmbiguityScenario(gocode, ctrlPlane),
    buildLandingPageScenario(gocode, ctrlPlane, config),
    symptomBlankPageScenario(gocode, ctrlPlane),
    symptomChangesNotShowingScenario(gocode, ctrlPlane),
    symptomModuleNotFoundScenario(gocode, ctrlPlane),
    multiTurnPublishFlowScenario(gocode, ctrlPlane, calibrate),
    contactPageExpectationsScenario(gocode, ctrlPlane, calibrate),
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
    addWelcomeEmailScenario(gocode, ctrlPlane),
    noNodemailerScenario(gocode, ctrlPlane),
    noSenderSpoofingScenario(gocode, ctrlPlane),
    emailWithAttachmentScenario(gocode, ctrlPlane),
    noRecipientFallbackScenario(gocode, ctrlPlane),
    emailOrderConfirmationScenario(gocode, ctrlPlane),
    inboxSkillEvalScenario(gocode, ctrlPlane),
    skillNonSelectionScenario(gocode, ctrlPlane),
    wrongSkillRoutingScenario(gocode, ctrlPlane),
    seoNonSelectionScenario(gocode, ctrlPlane),
    googleAnalyticsNonSelectionScenario(gocode, ctrlPlane),
    googleReviewsNonSelectionScenario(gocode, ctrlPlane),
    authenticationNonSelectionScenario(gocode, ctrlPlane),
    onlineAppointmentsNonSelectionScenario(gocode, ctrlPlane),
    commerceVsPaymentRoutingScenario(gocode, ctrlPlane),
    addMetaTagsScenario(gocode, ctrlPlane),
    seoAuditFlowScenario(gocode, ctrlPlane),
    noDuplicateTitlesScenario(gocode, ctrlPlane),
    followExistingPatternScenario(gocode, ctrlPlane),
    addStructuredDataScenario(gocode, ctrlPlane),
    registerNewRouteScenario(gocode, ctrlPlane),
    // 1b.ii mid-conversation variance scenario. Returns null unless the
    // operator-provisioned fixed base is configured (EVAL_INCREMENT_* env),
    // so it's absent from normal runs; filter the null out.
    midConversationIncrementScenario(gocode, ctrlPlane, config),
  ].filter((scenario): scenario is Scenario => scenario !== null);
}
