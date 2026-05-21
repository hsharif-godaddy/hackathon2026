import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { isEmployeeAuthType } from '@airo/shared/auth';

import { addCrmCaseNote, airoCertTokenService, type OpenCaseInput,openCrmCase } from '@/lib/crm';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import type { FanoutSubmitResponse } from '@/lib/feedback/fanout-types';
import { validateFanoutPayload } from '@/lib/feedback/fanout-validation';
import { buildInvestigateUrl } from '@/lib/feedback/investigate-url';
import { isInvestigationActive, readActiveState } from '@/lib/investigate/active-state';
import { invokeInvestigator } from '@/lib/investigate/invoke';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FEATURE_FLAG = 'appbuilder-feedback-fanout';
const LOG_DOMAIN = 'feedback.fanout';

function newInvestigationId(): string {
  const ts = new Date().toISOString().slice(0, 10);
  return `inv-${ts}-${randomUUID().slice(0, 8)}`;
}

function buildKeys(customerId: string, appId: string): {
  stateKey: string;
  resultKey: string;
  historyPrefix: string;
  tracePrefix: string;
  eventsPrefix: string;
} {
  const base = `active/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}`;
  const histBase = `history/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/`;
  return {
    stateKey: `${base}/state.json`,
    resultKey: `${base}/result.md`,
    historyPrefix: histBase,
    tracePrefix: `${base}/`,
    eventsPrefix: `events/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/`,
  };
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  const { customerId, shopperId, authType } = authContext.user;

  if (isEmployeeAuthType(authType)) {
    return NextResponse.json({ error: 'impersonation-not-allowed' }, { status: 403 });
  }
  if (shopperId?.length === 3) {
    return NextResponse.json({ error: 'internal-user-not-allowed' }, { status: 403 });
  }

  let flagOn = false;
  try {
    flagOn = await checkSwitchboardFlag(FEATURE_FLAG, request);
  } catch (err) {
    logger.warn(`${LOG_DOMAIN}.flag.lookup_failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!flagOn) {
    return NextResponse.json({ error: 'feature-disabled' }, { status: 403 });
  }

  // Distinct error from `feature-disabled` so ops can tell "flag rolled out
  // but cert env vars missing on this host" apart from "flag genuinely off".
  // Same 403 status — surface only varies the response body.
  if (!airoCertTokenService.isConfigured()) {
    return NextResponse.json({ error: 'cert-not-configured' }, { status: 403 });
  }

  // Asymmetry guards: BOTH `INVESTIGATE_LAMBDA_FN` and `INVESTIGATE_BUCKET`
  // need to be set for the dedup lock to function correctly. A deploy that
  // configures one without the other silently degrades:
  //   - LAMBDA_FN set, BUCKET unset → lock check returns null on every call;
  //     every submit invokes a fresh Lambda (defeats dedup).
  //   - BUCKET set, LAMBDA_FN unset → lock check works but there's no Lambda
  //     to invoke; fresh-invoke branch throws "INVESTIGATE_LAMBDA_FN env var
  //     not set" on every cache-miss path. Reuse-path keeps "working".
  // Both warn on each request rather than once per process so a deploy
  // mistake stays visible in Loki for the full window without surfacing as
  // a `.config.*_missing.fired_once` rate-limit artefact.
  if (process.env.INVESTIGATE_LAMBDA_FN && !process.env.INVESTIGATE_BUCKET) {
    logger.warn(`${LOG_DOMAIN}.config.bucket_missing`, {
      reason: 'INVESTIGATE_LAMBDA_FN set but INVESTIGATE_BUCKET unset — lock skipped',
    });
  }
  if (process.env.INVESTIGATE_BUCKET && !process.env.INVESTIGATE_LAMBDA_FN) {
    logger.warn(`${LOG_DOMAIN}.config.fn_missing`, {
      reason: 'INVESTIGATE_BUCKET set but INVESTIGATE_LAMBDA_FN unset — fresh invoke will throw',
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const validated = validateFanoutPayload(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: (validated as { ok: false; error: string }).error }, { status: 400 });
  }
  const payload = validated.payload;
  const appId = payload.appId;
  const isFeedback = payload.category === 'feedback';
  // `body` carries the customer's free-text. For issue/support it's the
  // bug description; for feedback (NPS) it's the comment. Kept as one
  // local because every downstream consumer (CRM case body, Lambda invoke
  // payload) treats it as opaque text from the customer.
  const body = isFeedback ? payload.comment : payload.description;
  const rating = isFeedback ? payload.rating : undefined;

  logger.info(`${LOG_DOMAIN}.start`, {
    customerId,
    appId,
    category: payload.category,
    rating,
  });

  // Lift the investigate URL above both the reuse and fresh-invoke
  // branches — both call `buildInvestigateUrl(appId, customerId)` with
  // identical args. Computing once makes it visible at a glance that
  // both code paths share the URL contract (review S-2). `null` is a
  // valid value (env var unset); both downstream branches handle it.
  const investigateUrl = appId ? buildInvestigateUrl(appId, customerId) : null;

  // CRM open (best-effort) — always runs. The CRM case captures the
  // submission verbatim, regardless of whether we end up triggering a
  // fresh investigation or piggybacking on one already in flight. Two
  // submissions back-to-back will produce two distinct CRM cases; only
  // the investigation Lambda is locked.
  let caseId: string | null = null;
  let caseNumber: string | null = null;
  let crmFailed = false;
  let crmIncomplete = false;

  try {
    // Discriminated union: build the input shape per category so TS
    // enforces rating + customerConsent presence on the feedback arm.
    const openInput: OpenCaseInput = isFeedback
      ? {
          customerId,
          shopperId,
          category: 'feedback',
          description: body,
          appId,
          topics: payload.topics,
          rating: payload.rating,
          customerConsent: payload.customerConsent,
        }
      : {
          customerId,
          shopperId,
          category: payload.category,
          description: body,
          appId,
          topics: payload.topics,
        };
    const result = await openCrmCase(openInput);
    caseId = result.caseId ?? null;
    caseNumber = result.caseNumber ?? null;
    if (result.incomplete) {
      // 2xx but no parseable caseId. The case may or may not have been
      // filed. Surface as a distinct warning (not crmFailed=true) so
      // downstream — UI toast + dashboards — can disambiguate.
      crmIncomplete = true;
      logger.warn(`${LOG_DOMAIN}.crm.incomplete`, {
        customerId,
        appId,
        category: payload.category,
      });
    } else {
      logger.info(`${LOG_DOMAIN}.crm.success`, { customerId, appId, caseId, caseNumber, category: payload.category });
    }
  } catch (err) {
    crmFailed = true;
    // CMAPI 5xx is treated as expected by spec (best-effort). Use warn so
    // routine outages don't page on-call; aggregate spikes still alert via
    // dashboards keyed on the log domain.
    logger.warn(`${LOG_DOMAIN}.crm.failed`, {
      customerId,
      appId,
      category: payload.category,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Investigator invoke (best-effort, scoped lock).
  //
  // If an investigation is already running for this (customerId, appId),
  // skip the new Lambda invoke and return the in-flight investigationId.
  // Mirrors the debug-console acquireLock pattern. The freshly created
  // CRM case (above) is still opened on the reuse path and gets a
  // fire-and-forget cross-link note pointing at the running Lambda.
  // Best-effort: if we can't read state (no IAM, no INVESTIGATE_BUCKET,
  // transport error) we proceed with a fresh invoke.
  let investigateFailed = false;
  let investigationId = newInvestigationId();
  let investigationReused = false;

  if (!appId) {
    investigateFailed = true;
    logger.warn(`${LOG_DOMAIN}.investigate.skipped`, { reason: 'missing-appId', customerId });
  } else {
    const existing = await readActiveState(customerId, appId);
    if (isInvestigationActive(existing)) {
      investigationId = existing.investigationId;
      investigationReused = true;
      logger.info(`${LOG_DOMAIN}.investigate.reused`, {
        customerId,
        appId,
        investigationId: existing.investigationId,
        runningCrmCaseId: existing.crmCaseId ?? null,
        newCrmCaseId: caseId,
        startedAt: existing.startedAt,
        lastHeartbeatAt: existing.lastHeartbeatAt,
      });

      // Spam-click linking: the new CRM case (just opened above) gets a
      // pointer back to the in-flight investigation so the support agent
      // who picks up the new case can follow the link instead of waiting
      // for the running Lambda's terminal mergeState (which only patches
      // the *original* case). Fire-and-forget so the customer's spinner
      // doesn't take CMAPI's tail latency (~9% > 10s) on every dedup —
      // the new case is already filed with the customer's complaint text;
      // only the cross-link is delayed if the POST stalls.
      if (caseId) {
        if (investigateUrl) {
          const note = `AI investigation already in progress for this app (deduplicated submission). Original investigation ID: ${existing.investigationId}. Track progress: ${investigateUrl}`;
          void addCrmCaseNote({ caseId, note }).catch((err: unknown) => {
            logger.warn(`${LOG_DOMAIN}.reuse.note_failed`, {
              caseId,
              investigationId: existing.investigationId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        } else {
          // DEBUG_CONSOLE_BASE_URL not set on this Katana env — case is
          // still filed; only the cross-link is missing. Configure the
          // var to match the matching CDK debugConsoleBaseUrl value.
          logger.warn(`${LOG_DOMAIN}.reuse.note_skipped`, {
            reason: 'DEBUG_CONSOLE_BASE_URL not set',
            caseId,
          });
        }
      }
    } else {
      // Build keys only inside the appId branch — the outer guard above
      // already returns when appId is missing, so keys are guaranteed to
      // be constructed with real (URL-encoded) appId segments.
      const keys = buildKeys(customerId, appId);
      try {
        await invokeInvestigator({
          investigationId,
          appId,
          customerId,
          feedback: body,
          fullstoryUrl: payload.fullStoryUrl,
          timeWindow: null,
          ...keys,
          source: 'feedback',
          category: payload.category,
          rating,
          topics: payload.topics,
          // Conditional spread instead of `customerConsent: undefined`:
          // `JSON.stringify` drops undefined keys today, but the safer
          // contract is to never put the key on the object in the first
          // place — the Lambda payload type marks `customerConsent` as
          // optional, and we shouldn't rely on JSON-marshalling
          // semantics if the AWS SDK ever changes how it serialises
          // Invoke payloads (review follow-up).
          ...(isFeedback ? { customerConsent: payload.customerConsent } : {}),
          crmCaseId: caseId ?? undefined,
          crmCaseNumber: caseNumber ?? undefined,
        });

        // Post a "kicked off" cross-link to the CRM case immediately. The
        // Lambda's terminal `maybeAddCrmCaseNote` only fires when status ===
        // 'completed' — if the Lambda is killed (SIGTERM after 14m), times
        // out, or fails, the original CRM case ends up with zero AI
        // context. Support agents reading the case have no way to know an
        // investigation was even attempted. This pre-flight note guarantees
        // a back-pointer regardless of how the Lambda exits. Fire-and-
        // forget so the customer's spinner doesn't take CMAPI's tail
        // latency (~9% > 10s) on every submit. Silent skip when
        // DEBUG_CONSOLE_BASE_URL is unset (symmetric with reuse-path).
        if (caseId && investigateUrl) {
          const note = `AI investigation kicked off for this case (investigationId: ${investigationId}). Track progress: ${investigateUrl}`;
          void addCrmCaseNote({ caseId, note }).catch((err: unknown) => {
            logger.warn(`${LOG_DOMAIN}.kickoff.note_failed`, {
              caseId,
              investigationId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        investigateFailed = true;
        logger.error(`${LOG_DOMAIN}.investigate.invoke_failed`, {
          investigationId,
          appId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (crmFailed && investigateFailed) {
    return NextResponse.json({ error: 'fanout-failed' }, { status: 502 });
  }

  const hasWarnings = crmFailed || crmIncomplete || investigateFailed || investigationReused;
  const response: FanoutSubmitResponse = {
    success: true,
    caseId,
    caseNumber,
    investigationId: investigateFailed ? null : investigationId,
    warnings: hasWarnings
      ? {
          ...(crmFailed ? { crmFailed: true } : {}),
          ...(crmIncomplete ? { crmIncomplete: true } : {}),
          ...(investigateFailed ? { investigateFailed: true } : {}),
          ...(investigationReused ? { reusedExisting: true } : {}),
        }
      : undefined,
  };
  return NextResponse.json(response);
});
