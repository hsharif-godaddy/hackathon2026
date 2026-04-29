import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { HttpError } from '@/lib/errors';
import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo/types';
import { ATTRIBUTE_KEYS } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { fireConversionEvent } from '@/utils/instrumentation';

// Persists across remounts/navigation within the same tab. Resets on full page reload.
// Growth is bounded by unique trial subscriptions per session (typically <10).
const acknowledgedIds = new Set<string>();

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

export function useConversionEvent(subscription: AiroSubscription | undefined): void {
  const queryClient = useQueryClient();

  const subscriptionId = subscription?.isTrial ? subscription.id : undefined;

  const { data: subscriptionWithAttrs, error: attrsError } = useQuery({
    queryKey: ['subscriptions', subscriptionId, 'attributes'],
    queryFn: () => fetchSubscriptionWithAttributes(subscriptionId!),
    enabled: !!subscriptionId,
    staleTime: 5 * 60 * 1000,
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
    if (attrsError) {
      logger.warn('conversion.attributes.error', {
        subscriptionId,
        error: attrsError instanceof Error ? attrsError.message : 'Unknown error',
      });
    }
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
