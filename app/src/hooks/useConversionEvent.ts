import { useEffect, useRef } from 'react';
import { type Query, useQuery, useQueryClient } from '@tanstack/react-query';

import { HttpError } from '@/lib/errors';
import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo/types';
import { ATTRIBUTE_KEYS } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { fireConversionEvent } from '@/utils/instrumentation';
import { type SubscriptionQueryData, useSubscription } from './useSubscription';

// Persists across remounts/navigation within the same tab. Resets on full page reload.
// Growth is bounded by unique trial subscriptions per session (typically <10).
const acknowledgedIds = new Set<string>();

// Guards the one-time poll-exhaustion warning per layer, so re-renders after the
// cap don't spam the log. Keyed `${layer}:${subscriptionId|gate}`.
const exhaustionLogged = new Set<string>();

// Guards the attributes-error warning. Each failed poll throws a fresh error instance,
// so a refetchInterval that keeps failing would re-fire the keyed effect every ~5s
// (up to ~24x before the cap). Log once per `${subscriptionId}:${status}` instead.
const attributesErrorLogged = new Set<string>();

/** Poll cadence while waiting for async mgmt-airo provisioning to surface the trial + orderId. */
export const CONVERSION_POLL_INTERVAL_MS = 5000;
/**
 * Max wall-clock time to poll before giving up (~2 min): long enough to cover observed mgmt-airo
 * provisioning lag for a brand-new account, short enough that an account that never provisions
 * stops polling promptly.
 *
 * Bounded by elapsed time per hook instance — NOT by `query.state.dataUpdateCount`. That count
 * lives on the shared Query cache entry, so for the gate's `['subscriptions']` key it is bumped
 * by every other consumer and every `invalidateQueries(['subscriptions'])`; capping on it would
 * read as "already exhausted" on a long-open page and the poll would never start. Wall-clock
 * elapsed is per-instance and immune to that.
 */
export const MAX_CONVERSION_POLL_DURATION_MS = 2 * 60 * 1000;

interface FreePlanAttributeValue {
  [key: string]: unknown;
  orderId: string;
  conversionEventDate: string | null;
}

function isFreePlanAttributeValue(v: Record<string, unknown>): v is FreePlanAttributeValue {
  return typeof v.orderId === 'string' && v.orderId.length > 0;
}

function getFreePlanAttribute(subscription: AiroSubscription): FreePlanAttributeValue | null {
  const attr = subscription.attributes?.find(a => a.key === ATTRIBUTE_KEYS.FREE_PLAN);
  if (!attr?.value) return null;
  if (!isFreePlanAttributeValue(attr.value)) return null;
  return attr.value;
}

/**
 * One-time breadcrumb when a poll layer stops because it hit the time cap (not because the work
 * resolved). This is the only client-side signal distinguishing "never provisioned" from "fired
 * silently" — the fire path only logs on failure. Called from the refetchInterval wrapper so it
 * sees the live elapsed time; predicates themselves stay pure.
 */
function logPollExhaustion(
  next: number | false,
  elapsedMs: number,
  layer: 'gate' | 'attributes',
  resolved: boolean,
  subscriptionId: string | undefined,
): void {
  if (next !== false) return;
  if (resolved) return;
  if (elapsedMs < MAX_CONVERSION_POLL_DURATION_MS) return;
  const key = subscriptionId ? `${layer}:${subscriptionId}` : layer;
  if (exhaustionLogged.has(key)) return;
  exhaustionLogged.add(key);
  logger.warn('conversion.poll.exhausted', { layer, subscriptionId, elapsedMs });
}

/**
 * Gate-layer poll predicate for the shared `['subscriptions']` query.
 *
 * A brand-new account reaches /develop before mgmt-airo finishes provisioning the trial
 * subscription, so the first read returns `active: null`. Keep polling only while no
 * subscription is visible yet; stop as soon as one resolves (a trial enables the attributes
 * query below; a non-trial means no conversion event applies). Bounded by per-instance elapsed
 * time (see MAX_CONVERSION_POLL_DURATION_MS — do not switch this to query.state.dataUpdateCount).
 */
export function gateRefetchInterval(query: Query<SubscriptionQueryData>, elapsedMs: number): number | false {
  if (elapsedMs >= MAX_CONVERSION_POLL_DURATION_MS) return false;
  return query.state.data?.active ? false : CONVERSION_POLL_INTERVAL_MS;
}

/**
 * Attribute-layer poll predicate for the per-subscription attributes query.
 *
 * Even once the trial is visible, the `free-plan`/`orderId` attribute can land a beat later.
 * Keep polling until the orderId appears (the effect fires on the resulting render), or the
 * conversion is already acknowledged server-side, or the time cap hits. Once the orderId is
 * present the fire effect runs and its own `acknowledgedIds` guard prevents a re-fire.
 */
export function attributesRefetchInterval(
  query: Query<AiroSubscription>,
  subscriptionId: string | undefined,
  elapsedMs: number,
): number | false {
  if (!subscriptionId) return false;
  if (elapsedMs >= MAX_CONVERSION_POLL_DURATION_MS) return false;
  const freePlan = query.state.data ? getFreePlanAttribute(query.state.data) : null;
  if (freePlan?.conversionEventDate != null) return false;
  if (freePlan?.orderId) return false;
  return CONVERSION_POLL_INTERVAL_MS;
}

async function fetchSubscriptionWithAttributes(subscriptionId: string): Promise<AiroSubscription> {
  const response = await appFetch(`/api/subscriptions/${subscriptionId}?include=attributes`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new HttpError(`Failed to fetch subscription: ${response.status}`, response.status);
  }

  const json = await response.json();
  if (!json.success || !json.data) {
    throw new Error(json.error || 'Failed to get subscription data');
  }
  return json.data;
}

export function useConversionEvent(): void {
  const queryClient = useQueryClient();

  // Per-instance poll-start anchors. Elapsed time is measured per hook mount, NOT off the shared
  // query's dataUpdateCount (which other ['subscriptions'] consumers and invalidations bump).
  const gateStartRef = useRef<number | null>(null);
  const attrsStartRef = useRef<number | null>(null);

  // Gate layer: poll the shared subscription query until a subscription is provisioned, so a
  // brand-new account's just-created trial is observed without a full page reload. The poll timer
  // is per-observer (TanStack v5), so this does not change cadence for other ['subscriptions']
  // consumers; the time cap is per-instance, so a long-open page does not start out "exhausted".
  const { data: subscription } = useSubscription({
    refetchInterval: (query) => {
      if (gateStartRef.current === null) gateStartRef.current = Date.now();
      const elapsedMs = Date.now() - gateStartRef.current;
      const next = gateRefetchInterval(query, elapsedMs);
      logPollExhaustion(next, elapsedMs, 'gate', query.state.data?.active != null, undefined);
      return next;
    },
  });

  // Only trials carry a free-plan conversion; a non-trial subscription never enables the
  // attributes query below, so the event cannot fire for it. Do not broaden this gate.
  const subscriptionId = subscription?.isTrial ? subscription.id : undefined;

  const { data: subscriptionWithAttrs, error: attrsError } = useQuery({
    queryKey: ['subscriptions', subscriptionId, 'attributes'],
    queryFn: () => fetchSubscriptionWithAttributes(subscriptionId!),
    enabled: !!subscriptionId,
    staleTime: 5 * 60 * 1000,
    // Attribute layer: poll until the orderId lands (provisioning lag) or the time cap is reached.
    refetchInterval: (query) => {
      if (attrsStartRef.current === null) attrsStartRef.current = Date.now();
      const elapsedMs = Date.now() - attrsStartRef.current;
      const next = attributesRefetchInterval(query, subscriptionId, elapsedMs);
      const resolved = query.state.data ? getFreePlanAttribute(query.state.data) != null : false;
      logPollExhaustion(next, elapsedMs, 'attributes', resolved, subscriptionId);
      return next;
    },
    retry(failureCount, error) {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay(attemptIndex) {
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
  });

  const freePlan = subscriptionWithAttrs ? getFreePlanAttribute(subscriptionWithAttrs) : null;
  const orderId = freePlan?.orderId;
  const isAcknowledged = freePlan?.conversionEventDate != null;

  useEffect(() => {
    if (!attrsError) return;
    const status = attrsError instanceof HttpError ? attrsError.status : undefined;
    const key = `${subscriptionId}:${status}`;
    if (attributesErrorLogged.has(key)) return;
    attributesErrorLogged.add(key);
    logger.warn('conversion.attributes.error', {
      subscriptionId,
      status,
      error: attrsError instanceof Error ? attrsError.message : 'Unknown error',
    });
  }, [attrsError, subscriptionId]);

  useEffect(() => {
    if (!subscriptionId || !orderId) return;
    if (isAcknowledged) return;
    if (acknowledgedIds.has(subscriptionId)) return;

    acknowledgedIds.add(subscriptionId);
    fireConversionEvent({ orderId });

    appFetch(`/api/subscriptions/${subscriptionId}/acknowledge`, {
      method: 'POST',
      credentials: 'include',
    }).then((response) => {
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      } else {
        logger.warn('conversion.acknowledge.http-error', {
          subscriptionId,
          status: response.status,
        });
      }
    }).catch((error) => {
      logger.warn('conversion.acknowledge.error', {
        subscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }, [subscriptionId, orderId, isAcknowledged, queryClient]);
}
