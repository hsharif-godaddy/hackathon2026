import { useCallback, useState } from 'react';

import {
  type DomainMutationDetails,
  type ModifyDomainsPayload,
  useModifyDomains
} from '@/hooks/useModifyDomains';
import {
  AIRO_SUBSCRIPTION_OWNER_TYPE,
  MWP_V2_APP_OWNER_TYPE
} from '@/lib/mgmt-airo/types';

interface LoggerLike {
  warn: (event: string, data: Record<string, unknown>) => void;
  error: (event: string, data: Record<string, unknown>) => void;
}

interface ShipAnalyticsLogLike {
  (event: string, properties?: Record<string, unknown>): void;
}

interface SendUserMessageLike {
  (message: string, options: { isActionRequest: true }): void;
}

interface UseDomainTransferParams {
  modifyDomainsMutation: ReturnType<typeof useModifyDomains>;
  conflictData: DomainMutationDetails['conflictDetails'] | null;
  setConflictData: (conflictData: DomainMutationDetails['conflictDetails'] | null) => void;
  logger: LoggerLike;
  shipAnalyticsLog: ShipAnalyticsLogLike;
  appId?: string;
  sendUserMessage?: SendUserMessageLike;
  successMessage?: string;
  analyticsPrefix: 'domain.attach.widget' | 'domain.custom';
  unsupportedOwnerTypeErrorMessage?: string;
}

function getLoggerEventName(analyticsPrefix: UseDomainTransferParams['analyticsPrefix']): string {
  return analyticsPrefix === 'domain.attach.widget'
    ? 'domain-attach-widget.transfer.failure'
    : 'domain-attach.transfer.failure';
}

export function useDomainTransfer({
  modifyDomainsMutation,
  conflictData,
  setConflictData,
  logger,
  shipAnalyticsLog,
  appId,
  sendUserMessage,
  successMessage,
  analyticsPrefix,
  unsupportedOwnerTypeErrorMessage = 'Failed to add domain',
}: UseDomainTransferParams) {
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<Error | null>(null);
  const { mutateAsync, reset } = modifyDomainsMutation;

  const handleTransferDomain = useCallback(async () => {
    if (!appId || !conflictData) return;
    if (
      conflictData.existingOwnerType !== AIRO_SUBSCRIPTION_OWNER_TYPE &&
      conflictData.existingOwnerType !== MWP_V2_APP_OWNER_TYPE
    ) {
      logger.warn('domain-conflict.unsupported-owner-type', { ownerType: conflictData.existingOwnerType });
      setTransferError(new Error(unsupportedOwnerTypeErrorMessage));
      return;
    }
    if (conflictData.existingOwnerType === AIRO_SUBSCRIPTION_OWNER_TYPE && !conflictData.existingSystemId) {
      logger.warn('domain-conflict.transfer.missing-system-id', {
        appId,
        ownerType: conflictData.existingOwnerType,
      });
      setTransferError(new Error(unsupportedOwnerTypeErrorMessage));
      return;
    }

    setTransferError(null);
    setIsTransferring(true);

    try {
      const payload: ModifyDomainsPayload = {
        domainsToCreate: [{ fqdn: conflictData.domain, primary: false }],
        createCdn: true,
        isWildcardDomain: true,
        ...(conflictData.existingOwnerType === MWP_V2_APP_OWNER_TYPE
          ? {
            transferFromMWP: {
              v2AppId: conflictData.existingAppId,
            },
          }
          : {
            transferFrom: {
              appId: conflictData.existingAppId,
              systemId: conflictData.existingSystemId ?? '',
              subscriptionId: conflictData.existingOwnerId,
            },
          }),
      };

      await mutateAsync({
        siteId: appId,
        payload,
      });

      shipAnalyticsLog(`${analyticsPrefix}.transfer.success`, {
        appId,
        domainName: conflictData.domain,
      });

      if (sendUserMessage) {
        sendUserMessage(successMessage || `Transferred ${conflictData.domain} to this app.`, { isActionRequest: true });
      }

      setConflictData(null);
      reset();
    } catch (error) {
      const transferDomainError = error instanceof Error ? error : new Error(String(error));

      logger.error(getLoggerEventName(analyticsPrefix), {
        message: 'Failed to transfer domain',
        appId,
        domainName: conflictData.domain,
        error: transferDomainError.message,
      });
      shipAnalyticsLog(`${analyticsPrefix}.transfer.failed`, {
        appId,
        domainName: conflictData.domain,
        error: transferDomainError.message,
      });
      setTransferError(transferDomainError);
    } finally {
      setIsTransferring(false);
    }
  }, [
    appId,
    analyticsPrefix,
    conflictData,
    logger,
    mutateAsync,
    reset,
    sendUserMessage,
    successMessage,
    setConflictData,
    shipAnalyticsLog,
    unsupportedOwnerTypeErrorMessage,
  ]);

  return {
    isTransferring,
    transferError,
    handleTransferDomain,
    clearTransferError: () => setTransferError(null),
  };
}
