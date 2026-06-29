import { ApiErrorCode } from '@airo/shared/api-error-code';
import { PublishDenialReason, PublishUpgradeRequiredError } from '@airo/shared/publish';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { usePaywallStore } from '@/stores/usePaywallStore';

export function isPermissionDeniedResponse(
  status: number,
  errorData: { code?: string },
): boolean {
  return status === 403 && errorData.code === ApiErrorCode.PermissionDenied;
}

export function shouldSuppressPublishError(appId: string): boolean {
  if (usePaywallStore.getState().showUpgradeModal) {
    return true;
  }
  return useDevelopPageStore.getState().publishStates[appId]?.showPublishLimitModal === true;
}

export function handlePublishPermissionDenied(appId: string): void {
  usePaywallStore.getState().openUpgradeModal('publish', PAYWALL_ITC.PUBLISH);
  const developStore = useDevelopPageStore.getState();
  developStore.setFirstPublishDeployPending(appId, false);
  developStore.setIsPublishing(appId, false);
}

export function publishPermissionDeniedError(message?: string): PublishUpgradeRequiredError {
  return new PublishUpgradeRequiredError(PublishDenialReason.NoSubscription, message);
}
