import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo/types';
import { ATTRIBUTE_KEYS } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { fireConversionEvent } from '@/utils/conversion-event';

const STORAGE_KEY_PREFIX = 'airo:conversion:acknowledged:';

interface FreePlanAttributeValue {
  orderId: string;
  conversionEventDate: string | null;
}

function getFreePlanAttribute(subscription: AiroSubscription): FreePlanAttributeValue | null {
  const attr = subscription.attributes?.find(a => a.key === ATTRIBUTE_KEYS.FREE_PLAN);
  if (!attr?.value) return null;
  const value = attr.value as FreePlanAttributeValue;
  if (!value.orderId) return null;
  return value;
}

function getStorageKey(subscriptionId: string): string {
  return `${STORAGE_KEY_PREFIX}${subscriptionId}`;
}

function isAcknowledgedInSession(subscriptionId: string): boolean {
  try {
    return sessionStorage.getItem(getStorageKey(subscriptionId)) === 'true';
  } catch {
    return false;
  }
}

function markAcknowledgedInSession(subscriptionId: string): void {
  try {
    sessionStorage.setItem(getStorageKey(subscriptionId), 'true');
  } catch {
    // sessionStorage unavailable (private browsing, storage full)
  }
}

export function useConversionEvent(subscription: AiroSubscription | undefined): void {
  const firedRef = useRef(false);
  const queryClient = useQueryClient();

  const freePlan = subscription ? getFreePlanAttribute(subscription) : null;
  const orderId = freePlan?.orderId;
  const isAcknowledged = freePlan?.conversionEventDate != null;

  useEffect(() => {
    if (!subscription || !orderId) return;
    if (isAcknowledged) return;
    if (firedRef.current) return;
    if (isAcknowledgedInSession(subscription.id)) return;

    firedRef.current = true;
    markAcknowledgedInSession(subscription.id);

    fireConversionEvent({ orderId });

    appFetch('/api/subscriptions/acknowledge', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionId: subscription.id }),
    }).then((response) => {
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      } else {
        logger.warn('conversion.acknowledge.failed', {
          subscriptionId: subscription.id,
          status: response.status,
        });
      }
    }).catch((error) => {
      logger.warn('conversion.acknowledge.error', {
        subscriptionId: subscription.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }, [subscription?.id, orderId, isAcknowledged, queryClient]);
}
