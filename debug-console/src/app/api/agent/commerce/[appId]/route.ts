import { NextRequest, NextResponse } from 'next/server';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';
import { getStripeStatusFromLogs } from '@/lib/stripe-status';

export const dynamic = 'force-dynamic';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type PaymentProvider = 'godaddy_payments' | 'stripe' | 'unknown';

interface CommerceBindingPayload {
  configured?: boolean;
  binding?: unknown;
}

/**
 * Fetch the GoDaddy Commerce binding from the per-app agent. Best-effort: a
 * missing agent route (old pinned image) or an upstream error degrades to a
 * not-configured result so the Stripe signal can still render.
 */
async function loadBinding(appId: string): Promise<CommerceBindingPayload> {
  try {
    const { status, body } = await fetchAgentJson({
      appId,
      path: `/apps/${encodeURIComponent(appId)}/commerce/binding`,
    });
    if (status >= 400) {
      logger.warn('agent.commerce.binding.bad_status', { appId, status });
      return { configured: false, binding: null };
    }
    return (body ?? {}) as CommerceBindingPayload;
  } catch (error) {
    if (error instanceof AgentUrlNotFoundError) {
      logger.warn('agent.commerce.binding.unavailable', { appId, reason: error.message });
    } else {
      logger.warn('agent.commerce.binding.error', { appId }, { error: error as Error });
    }
    return { configured: false, binding: null };
  }
}

export const GET = withAuth<{ appId: string }>(async function getCommerceBinding(
  _request: NextRequest,
  _auth,
  context
) {
  const { appId } = await context.params;
  if (!APP_ID_RE.test(appId)) {
    return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
  }

  const [binding, stripe] = await Promise.all([loadBinding(appId), getStripeStatusFromLogs(appId)]);

  const godaddyConfigured = binding.configured === true;
  const paymentProvider: PaymentProvider = godaddyConfigured
    ? 'godaddy_payments'
    : stripe.detected
      ? 'stripe'
      : 'unknown';

  return NextResponse.json({
    configured: godaddyConfigured,
    binding: binding.binding ?? null,
    stripe,
    paymentProvider,
    commerceIntent: godaddyConfigured || stripe.detected,
  });
});
