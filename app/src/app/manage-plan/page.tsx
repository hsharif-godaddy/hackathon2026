'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Tag from '@ux/tag';
import text from '@ux/text';

import SinglePlanUpgradeContainer from '@/app/develop/components/SinglePlanUpgradeContainer';
import {
  CreditPacksCard,
  ManagePlanSkeleton,
  PageLayout,
  PlanCreditCard,
} from '@/app/manage-plan/components';
import { ProtectedRoute } from '@/components/auth';
import { useActiveSubscription } from '@/hooks/useActiveSubscription';
import { useCreditGrants } from '@/hooks/useCreditGrants';
import { useGasketData } from '@/hooks/useGasketData';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import type { CreditGrant, Subscription } from '@/types/credits';
import { SubscriptionPlan } from '@/types/credits';
import {
  formatFullCreditDate,
  getActiveGrant,
  getCreditPackGrants,
  getMonthlyPlanGrant,
  getPlanDisplayLabelKey,
} from '@/utils/credits';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';

/**
 * Mock subscription data
 */
// const DEFAULT_SUBSCRIPTION = {
//   builderEntitlementId: '55aa4158-c62e-11f0-7c68-d205a6ffb798',
//   plan: SubscriptionPlan.Free,
//   updatedAt: new Date().toISOString(),
//   renewsAt: null,
// };

function ManagePlanContent() {
  const t = useTranslations();
  const gasketData = useGasketData();
  const locale = gasketData?.intl?.locale;
  const [showPaywallModal, setShowPaywallModal] = useState(false);
  const [paywallSource, setPaywallSource] = useState<string | null>(null);

  const openPaywall = (source: string) => {
    setPaywallSource(source);
    setShowPaywallModal(true);
    shipAnalyticsLog(`${source}.shown`, {});
  };

  const closePaywall = () => {
    setShowPaywallModal(false);
  };

  useEffect(function logPageView() {
    logImpressionEvent('manage_plan.page.view')();
  }, []);

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useActiveSubscription();

  const {
    data: grantsData,
    isLoading: isGrantsLoading,
    isError: isGrantsError,
  } = useCreditGrants({
    subscriptionId: subscriptionData?.id,
  });

  // TODO: clean up this merge API data with defaults (spread mock data into response)
  const subscription: Subscription = {
    // ...DEFAULT_SUBSCRIPTION,
    ...subscriptionData,
  };
  const grants: CreditGrant[] = grantsData || [];

  const monthlyGrant = getMonthlyPlanGrant(grants);
  const creditPacks = getCreditPackGrants(grants);
  const activeGrant = getActiveGrant(grants);

  const planLabelKey = getPlanDisplayLabelKey(subscription.plan);
  const planDisplayLabel = planLabelKey ? t(planLabelKey) : '';
  const isFreePlan = subscription.plan === SubscriptionPlan.Free;
  const hasCreditsNoPlan = creditPacks.length > 0 && isFreePlan;

  // Calculate reset date from monthly grant useBefore or subscription renewsAt
  const resetDate = monthlyGrant
    ? formatFullCreditDate(monthlyGrant.useBefore, locale)
    : subscription.renewsAt
      ? formatFullCreditDate(subscription.renewsAt, locale)
      : null;

  // Calculate reset time from monthly grant created time
  const resetTime = monthlyGrant
    ? new Date(monthlyGrant.createdAt).toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null;

  if (isSubscriptionLoading || isGrantsLoading) {
    return (
      <PageLayout>
        <ManagePlanSkeleton />
      </PageLayout>
    );
  }

  if (isSubscriptionError || isGrantsError) {
    return (
      <PageLayout>
        <div className="bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 sm:p-6">
          <text.p as="paragraph" className="text-center" text={t('builder_manageplan_error')} />
        </div>
      </PageLayout>
    );
  }

  return (
    <>
      {showPaywallModal && (
        <SinglePlanUpgradeContainer
          onSuccessClick={() => {
            const source = paywallSource ?? 'unknown';
            closePaywall();
            shipAnalyticsLog(`${source}.success`, {});
          }}
          onClose={() => {
            const source = paywallSource ?? 'unknown';
            closePaywall();
            shipAnalyticsLog(`${source}.dismissed`, {});
          }}
          onErrorClick={() => {
            const source = paywallSource ?? 'unknown';
            closePaywall();
            shipAnalyticsLog(`${source}.error`, {});
          }}
        />
      )}
      <PageLayout>
        <div className="bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 sm:p-6">
          <div className="flex flex-col-reverse items-start gap-2 md:flex-row md:justify-between mb-2">
            <text.h2 as="title" size={3} text={t('builder_manageplan_title')} />
            {isFreePlan ? (
              <Tag emphasis="passive">
                {planDisplayLabel}
              </Tag>
            ) : planDisplayLabel ? (
              <Tag className="!bg-ai-light !text-intents-ux-boxHighContrast-foregroundColor">
                {planDisplayLabel}
              </Tag>
            ) : null}
          </div>

          <div className="flex flex-col">
            {resetDate && resetTime && (
                <text.p as="paragraph" className={clsx(hasCreditsNoPlan ? 'mb-1' : 'mb-4')}>
                {t('builder_manageplan_reset_info', {
                    date: resetDate,
                    time: resetTime,
                })}
                </text.p>
            )}
            {hasCreditsNoPlan && (
                <text.p as="paragraph" className="mb-4" text={t('builder_manageplan_creditpacks_empty_plan_description')} />
            )}
          </div>

          { (creditPacks.length > 0 || (!isFreePlan && creditPacks.length === 0)) && (
            <Box orientation="horizontal" gap="md" className="mb-4">
                { isFreePlan && creditPacks.length > 0 && (
                    <Button
                        design="primary"
                        data-partial='componentAiro'
                        data-eid={generateClickEID('manage_plan.upgrade')}
                        size="sm"
                        text={t('builder_manageplan_upgrade')}
                        onClick={() => openPaywall('manage_plan.upgrade')}
                    />
                )}
                { creditPacks.length > 0 && (
                    <Button
                        design="secondary"
                        data-partial='componentAiro'
                        data-eid={generateClickEID('manage_plan.buy_credits')}
                        size="sm"
                        text={t('builder_manageplan_buy_credits')}
                        onClick={() => openPaywall('manage_plan.buy_credits')}
                    />
                )}
                { !isFreePlan && (
                    <Button
                        className="items-center"
                        design="inline"
                        data-partial='componentAiro'
                        data-eid={generateClickEID('manage_plan.cancel_plan')}
                        size="sm"
                        text={t('builder_manageplan_cancel_plan')}
                        href={`https://account.${getRootDomain() || 'godaddy.com'}/subscriptions`}
                    />
                )}
            </Box>
          )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <PlanCreditCard
                grant={monthlyGrant}
                isActive={monthlyGrant ? activeGrant?.id === monthlyGrant.id : false}
                locale={locale}
              />

              <CreditPacksCard
                creditPacks={creditPacks}
                subscriptionPlan={subscription.plan}
                activeGrantId={activeGrant?.id}
                locale={locale}
                onOpenPaywall={openPaywall}
              />
        </div>
      </div>
      </PageLayout>
    </>
  );
}

export default function ManagePlan() {
  const t = useTranslations();
  const router = useRouter();
  const { data: isFeatureEnabled, isLoading: isFeatureLoading } = useSwitchboard('appbuilder-manage-plan');

  useEffect(function redirectIfDisabled() {
    if (!isFeatureLoading && !isFeatureEnabled) {
      router.replace('/');
    }
  }, [isFeatureEnabled, isFeatureLoading, router]);

  if (isFeatureLoading || !isFeatureEnabled) {
    return (
      <PageLayout>
        <ManagePlanSkeleton />
      </PageLayout>
    );
  }

  return (
    <ProtectedRoute unauthorizedMessage={t('builder_manageplan_signin_required')}>
      <ManagePlanContent />
    </ProtectedRoute>
  );
}
