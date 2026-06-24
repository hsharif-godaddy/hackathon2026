/**
 * Payment Funnel Tracking
 *
 * Five-step funnel for payment integration flows:
 *   1. payment.intent.detected   — user/agent loads a payment skill
 *   2. payment.skill.invoked     — any load/install of a payment skill (non-idempotent)
 *   3. payment.setup.started     — provider setup tool fires
 *   4. payment.setup.completed   — provider setup tool succeeds with a usable result
 *   5. payment.setup.verified    — end-to-end ready signal (channel ensured / live keys)
 *
 * Idempotency is per-provider per app: switching providers replays the funnel.
 */

import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';

export type PaymentProvider = 'godaddy_payments' | 'stripe' | 'unknown';
export type PaymentFlow = 'auto_provisioned' | 'manual_keys';
export type PaymentFailureDetails = {
  errorCode?: number | string;
  errorType?: string;
  flow?: PaymentFlow;
  toolName: string;
};

interface ProviderState {
  intentLogged: boolean;
  setupStarted: boolean;
  setupCompleted: boolean;
  setupFailed: boolean;
  setupVerified: boolean;
  setupVerifyFailed: boolean;
  setupStartedAt: number | null;
}

let funnelAppId: string | null = null;
const providerState = new Map<PaymentProvider, ProviderState>();

function ensureProviderState(provider: PaymentProvider): ProviderState {
  let state = providerState.get(provider);
  if (!state) {
    state = {
      intentLogged: false,
      setupStarted: false,
      setupCompleted: false,
      setupFailed: false,
      setupVerified: false,
      setupVerifyFailed: false,
      setupStartedAt: null,
    };
    providerState.set(provider, state);
  }
  return state;
}

function ensureAppScope(appId: string | null): void {
  if (appId && funnelAppId && funnelAppId !== appId) {
    resetPaymentFunnel();
  }
  if (appId) funnelAppId = appId;
}

export function detectPaymentProvider(skillName: string | undefined | null): PaymentProvider {
  if (!skillName) return 'unknown';
  if (skillName === 'payment/stripe') return 'stripe';
  if (skillName === 'payment/godaddy-payments') return 'godaddy_payments';
  // Commerce skills are backed by GoDaddy Commerce → GoDaddy Payments.
  if (skillName === 'commerce' || skillName.startsWith('commerce/')) return 'godaddy_payments';
  return 'unknown';
}

export function isPaymentRelatedSkill(skillName: string | undefined | null): boolean {
  if (typeof skillName !== 'string') return false;
  return (
    skillName === 'payment' ||
    skillName.startsWith('payment/') ||
    skillName === 'commerce' ||
    skillName.startsWith('commerce/')
  );
}

export function trackPaymentIntent(appId: string | null, skillName: string): void {
  ensureAppScope(appId);
  const provider = detectPaymentProvider(skillName);
  const state = ensureProviderState(provider);
  if (state.intentLogged) return;
  state.intentLogged = true;

  const payload = { appId, provider, skillName };
  shipAnalyticsLog('payment.intent.detected', payload);
  logImpressionEvent('develop.payment.intent_detected', {
    appId: appId ?? '',
    provider,
    skillName,
  })();
}

export function trackPaymentSkillInvoked(
  appId: string | null,
  skillName: string,
  action: 'load' | 'install'
): void {
  ensureAppScope(appId);
  const provider = detectPaymentProvider(skillName);
  const payload = { appId, provider, skillName, skillAction: action };
  shipAnalyticsLog('payment.skill.invoked', payload);
  logImpressionEvent('develop.payment.skill_invoked', {
    appId: appId ?? '',
    provider,
    skillName,
    skillAction: action,
  })();
}

export function trackPaymentSetupStarted(appId: string | null, provider: PaymentProvider): void {
  ensureAppScope(appId);
  const state = ensureProviderState(provider);
  if (state.setupStarted) return;
  state.setupStarted = true;
  state.setupStartedAt = Date.now();

  const payload = { appId, provider };
  shipAnalyticsLog('payment.setup.started', payload);
  logImpressionEvent('develop.payment.setup_started', {
    appId: appId ?? '',
    provider,
  })();
}

export function trackPaymentSetupCompleted(
  appId: string | null,
  provider: PaymentProvider,
  flow?: PaymentFlow
): void {
  ensureAppScope(appId);
  const state = ensureProviderState(provider);
  if (state.setupCompleted) return;
  state.setupCompleted = true;

  const durationMs = state.setupStartedAt ? Date.now() - state.setupStartedAt : undefined;
  const payload = {
    appId,
    provider,
    ...(flow && { flow }),
    ...(durationMs !== undefined && { durationMs }),
  };
  shipAnalyticsLog('payment.setup.completed', payload);
  logImpressionEvent('develop.payment.setup_completed', {
    appId: appId ?? '',
    provider,
    ...(flow && { flow }),
    ...(durationMs !== undefined && { durationMs }),
  })();
}

export function trackPaymentSetupFailed(
  appId: string | null,
  provider: PaymentProvider,
  details: PaymentFailureDetails
): void {
  ensureAppScope(appId);
  const state = ensureProviderState(provider);
  if (state.setupFailed) return;
  state.setupFailed = true;

  const durationMs = state.setupStartedAt ? Date.now() - state.setupStartedAt : undefined;
  const payload = {
    appId,
    provider,
    toolName: details.toolName,
    ...(details.flow && { flow: details.flow }),
    ...(details.errorType && { errorType: details.errorType }),
    ...(details.errorCode !== undefined && { errorCode: details.errorCode }),
    ...(durationMs !== undefined && { durationMs }),
  };
  shipAnalyticsLog('payment.setup.failed', payload);
  logImpressionEvent('develop.payment.setup_failed', {
    appId: appId ?? '',
    provider,
    toolName: details.toolName,
    ...(details.flow && { flow: details.flow }),
    ...(details.errorType && { errorType: details.errorType }),
    ...(details.errorCode !== undefined && { errorCode: details.errorCode }),
    ...(durationMs !== undefined && { durationMs }),
  })();
}

export function trackPaymentSetupVerified(
  appId: string | null,
  provider: PaymentProvider,
  flow?: PaymentFlow
): void {
  ensureAppScope(appId);
  const state = ensureProviderState(provider);
  if (state.setupVerified) return;
  state.setupVerified = true;

  const durationMs = state.setupStartedAt ? Date.now() - state.setupStartedAt : undefined;
  const payload = {
    appId,
    provider,
    ...(flow && { flow }),
    ...(durationMs !== undefined && { durationMs }),
  };
  shipAnalyticsLog('payment.setup.verified', payload);
  logImpressionEvent('develop.payment.setup_verified', {
    appId: appId ?? '',
    provider,
    ...(flow && { flow }),
    ...(durationMs !== undefined && { durationMs }),
  })();
}

export function trackPaymentSetupVerifyFailed(
  appId: string | null,
  provider: PaymentProvider,
  details: PaymentFailureDetails
): void {
  ensureAppScope(appId);
  const state = ensureProviderState(provider);
  if (state.setupVerifyFailed) return;
  state.setupVerifyFailed = true;

  const durationMs = state.setupStartedAt ? Date.now() - state.setupStartedAt : undefined;
  const payload = {
    appId,
    provider,
    toolName: details.toolName,
    ...(details.flow && { flow: details.flow }),
    ...(details.errorType && { errorType: details.errorType }),
    ...(details.errorCode !== undefined && { errorCode: details.errorCode }),
    ...(durationMs !== undefined && { durationMs }),
  };
  shipAnalyticsLog('payment.setup.verify_failed', payload);
  logImpressionEvent('develop.payment.setup_verify_failed', {
    appId: appId ?? '',
    provider,
    toolName: details.toolName,
    ...(details.flow && { flow: details.flow }),
    ...(details.errorType && { errorType: details.errorType }),
    ...(details.errorCode !== undefined && { errorCode: details.errorCode }),
    ...(durationMs !== undefined && { durationMs }),
  })();
}

export function resetPaymentFunnel(): void {
  funnelAppId = null;
  providerState.clear();
}
