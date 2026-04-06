'use client';

import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import type { SiteInfo } from '@/lib/control-plane/types';
import {
  getPublishComplianceBlockReason,
  isPublishBlockedByComplianceRules,
  PublishComplianceBlockReason,
} from '@/lib/subscription';

type SiteLike = Pick<SiteInfo, 'status'> | null | undefined;

export function usePublishComplianceGate(
  site: SiteLike,
  options: { enabled?: boolean } = {}
) {
  const t = useTranslations();
  const { enabled = true } = options;
  const { data: subscription } = useSubscription({ enabled });
  const { data: complianceFlag } = useSwitchboard('appbuilder-suspended-compliance-banner', {
    enabled,
  });
  const complianceSubscriptionRulesEnabled = complianceFlag === true;
  const blocked = isPublishBlockedByComplianceRules(
    site,
    subscription,
    complianceSubscriptionRulesEnabled
  );
  const reason = getPublishComplianceBlockReason(
    site,
    subscription,
    complianceSubscriptionRulesEnabled
  );
  const blockMessage =
    reason === PublishComplianceBlockReason.SiteSuspended
      ? t('builder_manageplan_apps_publish_blocked_suspended')
      : reason === PublishComplianceBlockReason.SubscriptionNonCompliant
        ? t('builder_manageplan_apps_publish_blocked_subscription')
        : null;
  return {
    isBlocked: blocked,
    blockReason: reason,
    blockMessage,
  };
}
