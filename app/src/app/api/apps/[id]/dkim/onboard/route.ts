import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DkimAgentClient } from '@/lib/dkim/dkim-agent-client';
import { getDkimStatusCached } from '@/lib/dkim/dkim-cache';
import { DkimService } from '@/lib/dkim/dkim-service';
import { DkimErrorCode, type DkimOnboardOutcome } from '@/lib/dkim/types';
import { deriveDomainOrigin } from '@/lib/dkim/utils';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const rawDomain = body.domain;

  if (!rawDomain || typeof rawDomain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }
  const domain = rawDomain.toLowerCase();

  // Early flag check — short-circuit before any upstream calls
  // (getSite, getDomainDnsOwnership). DkimService also enforces this
  // gate as defense-in-depth, but checking here saves the round-trips
  // to mgmt-hosting + mgmt-airo when the feature is off across a
  // partial-rollout customer base. The pre-existing
  // /api/sites/[id]/domain-dns-ownership route (used for DNS-instruction
  // flows independent of DKIM) is NOT affected — it stays callable for
  // every authenticated request as before.
  const flagOn = await checkSwitchboardFlag('appbuilder-dkim-onboarding', request);
  if (!flagOn) {
    logger.info('dkim.onboard.skipped.feature_flag_off', { appId, domain });
    const outcome: DkimOnboardOutcome = { result: 'skipped', reason: 'feature_flag_off' };
    return NextResponse.json(outcome);
  }

  // Wrap upstream calls — adapter.getSite and mgmtClient.getDomainDnsOwnership
  // can throw on network/auth errors. Match the structured-logging pattern
  // used by sites/[id]/domain-dns-ownership/route.ts so failures are
  // observable with appId/domain context instead of leaking generic 500s.
  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, authContext.jwt!);
    if (!site) {
      return NextResponse.json({ code: ApiErrorCode.SITE_NOT_FOUND, error: 'Site not found' }, { status: 404 });
    }
    if (!site.subscription_id || !site.system_id) {
      return NextResponse.json({ code: ApiErrorCode.SITE_CONFIG_INCOMPLETE, error: 'Site config incomplete' }, { status: 400 });
    }

    // Verify the domain is actually attached to this app before doing any
    // privileged provisioning. Mirrors the same check in dkim/status/route.ts.
    // Without this, an authenticated attacker could pass arbitrary domains and
    // trigger Vox provisioning + global durable claims for domains they don't own.
    const attachedFqdns = (site.domains ?? []).map((d: { fqdn: string }) => d.fqdn.toLowerCase());
    if (!attachedFqdns.includes(domain)) {
      logger.warn('dkim.onboard.domain.not-attached', { appId, domain });
      return NextResponse.json({ error: 'domain is not attached to this app' }, { status: 403 });
    }

    const mgmtClient = new AiroMgmtClient({
      baseUrl: process.env.MGMT_AIRO_BASE_URL ?? 'https://mgmt.nstk.net',
      jwt: authContext.jwt!,
    });
    const ownership = await mgmtClient.getDomainDnsOwnership(
      site.subscription_id,
      site.system_id,
      appId,
      { fqdns: domain, customerId: authContext.user.customerId, shopperId: authContext.user.shopperId },
    );

    const origin = deriveDomainOrigin(ownership);

    const durableEnabled = await checkSwitchboardFlag('appbuilder-dkim-durable-state', request);
    if (!durableEnabled) {
      // Pre-durable fallback: provision via Vox directly, no durable claim/state.
      logger.info('dkim.onboard.durable-disabled', { appId, domain });
      const service = new DkimService();
      const outcome = await service.activate({
        appId,
        domain,
        shopperId: authContext.user.shopperId,
        origin,
      }, request);
      return NextResponse.json(outcome);
    }

    if (!site.agent_url) {
      logger.warn('dkim.onboard.no-agent-url', { appId, domain });
      const outcome: DkimOnboardOutcome = { result: 'skipped', reason: 'no_agent_url' };
      return NextResponse.json(outcome);
    }
    const dkimAgent = new DkimAgentClient(site.agent_url, appId);

    // Already-valid pre-check: covers domains the DKIM team backfilled
    // out-of-band (already dkimValid) and any domain valid by other means.
    // Adopt the durable record and skip Vox. A status-check failure must not
    // block onboarding, so swallow and fall through to claim.
    let dnsKnownInvalid = false;
    try {
      const current = await getDkimStatusCached(domain);
      if (current.dkimValid) {
        await dkimAgent.markActive(domain).catch((e: unknown) => {
          logger.warn('dkim.onboard.markActive.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
        });
        logger.info('dkim.onboard.skipped.already_active', { appId, domain });
        const outcome: DkimOnboardOutcome = { result: 'noop', reason: 'already_active' };
        return NextResponse.json(outcome);
      }
      // Pre-check succeeded and DNS is NOT valid — used below to recover a
      // stale 'active' row (see stale-active recovery).
      dnsKnownInvalid = true;
    } catch (e) {
      logger.warn('dkim.onboard.precheck.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
    }

    // Idempotent claim. claimed=false => active or fresh-pending => no-op.
    let { claimed, status } = await dkimAgent.claim(domain);

    // Stale-active recovery: the row says 'active' but the pre-check
    // DEFINITIVELY observed DNS invalid (a prior offboard failed to tear the
    // row down, or a flag-flip left it orphaned). Clear it and re-claim so we
    // re-provision instead of returning a false already_active forever. Only
    // when dnsKnownInvalid — never act on an unknown (pre-check threw) state.
    if (!claimed && status === 'active' && dnsKnownInvalid) {
      logger.info('dkim.onboard.stale-active.recover', { appId, domain });
      await dkimAgent.deleteRow(domain, { ifStatus: 'active' }).catch((e: unknown) => {
        logger.error('dkim.onboard.stale-active.delete-failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
      ({ claimed, status } = await dkimAgent.claim(domain));
    }

    if (!claimed) {
      const reason = status === 'active' ? 'already_active' : 'in_progress';
      logger.info('dkim.onboard.skipped', { appId, domain, reason, status });
      const outcome: DkimOnboardOutcome = { result: 'noop', reason };
      return NextResponse.json(outcome);
    }

    logger.info('dkim.auto-onboard.trigger', { appId, domain, isGoDaddyDns: ownership.isGoDaddyDns });
    const service = new DkimService();
    const outcome = await service.activate({
      appId,
      domain,
      shopperId: authContext.user.shopperId,
      origin,
    }, request);

    if (outcome.result === 'accepted') {
      await dkimAgent.setAccepted(domain, outcome.executionArn).catch((e: unknown) => {
        logger.warn('dkim.onboard.setAccepted.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
    } else if (outcome.result === 'failed') {
      await dkimAgent.setFailed(domain, outcome.error).catch((e: unknown) => {
        logger.warn('dkim.onboard.setFailed.failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
    } else if (outcome.result === 'skipped') {
      // activate re-checked flag/origin and bailed AFTER we claimed a pending
      // row. Undo the speculative claim so it doesn't strand for the cooldown.
      logger.warn('dkim.onboard.skipped-after-claim', { appId, domain, reason: outcome.reason });
      await dkimAgent.deleteRow(domain).catch((e: unknown) => {
        logger.warn('dkim.onboard.skipped-after-claim.delete-failed', { appId, domain, error: e instanceof Error ? e.message : String(e) });
      });
    }

    return NextResponse.json(outcome);
  } catch (err) {
    const isAiro = err instanceof AiroHttpError;
    const status = isAiro ? err.status : 500;
    // mgmt-hosting hasn't propagated a freshly (re)attached domain yet → transient, retryable.
    const code = isAiro && (status === 404 || status === 409)
      ? DkimErrorCode.DOMAIN_NOT_READY
      : DkimErrorCode.ONBOARD_FAILED;
    logger.error('dkim.onboard.error', {
      appId,
      domain,
      code,
      error: err instanceof Error ? err.message : String(err),
      errorBody: isAiro ? JSON.stringify(err) : undefined,
    });
    return NextResponse.json(
      { code, error: 'DKIM onboarding failed', details: err instanceof Error ? err.message : 'Unknown error' },
      { status },
    );
  }
}, { level: 3 });
