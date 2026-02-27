"use client";

import Alert from '@ux/alert';

import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { isPaidPlanForGrants } from '@/lib/paywall/shared';

export default function AppInactivityAlert() {
  const t = useTranslations();
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription();
  const { data: isGrantsEnabled, isLoading: isGrantsLoading } = useSwitchboard('app-builder-grants');
  const isPaidPlan = isPaidPlanForGrants(subscription?.plan, isGrantsEnabled ?? true);

  if (isPaidPlan || isSubscriptionLoading || isGrantsLoading) {
    return null;
  }

  return (
    <div className="mb-3">
      <Alert emphasis="highlight" title={t('builder_layout_inactivity_alert_title')}>
        {t('builder_layout_inactivity_alert')}
      </Alert>
    </div>
  );
}
