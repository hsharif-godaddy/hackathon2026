'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Tag from '@ux/tag';
import text from '@ux/text';

import CreditsUpgradeContainer from '@/app/develop/components/CreditsUpgradeContainer';
import SinglePlanUpgradeContainer from '@/app/develop/components/SinglePlanUpgradeContainer';
import {
  CreditPacksCard,
  ManagePlanSkeleton,
  PageLayout,
  PlanCreditCard,
} from '@/app/manage-plan/components';
import { ProtectedRoute } from '@/components/auth';
import { useCreditGrants } from '@/hooks/useCreditGrants';
import { useGasketData } from '@/hooks/useGasketData';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { ClientLogBuffer, shipAnalyticsLog } from '@/lib/logging';
import type { CreditGrant } from '@/types/credits';
import { SubscriptionPlan } from '@/types/credits';
import {
  formatFullCreditDate,
  getActiveGrant,
  getCreditPackGrants,
  getMonthlyPlanGrant,
  getPlanDisplayLabelKey,
  getPlanFromSubscription,
} from '@/utils/credits';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';

type PaywallType = 'upgrade' | 'credits';

/**
 * Wrapper component for the credits paywall fallback that logs a warning
 * when triggered due to missing entitlementId.
 */
function CreditsPaywallFallback({
  source,
  subscriptionId,
  onSuccessClick,
  onClose,
  onErrorClick,
}: {
  source: string;
  subscriptionId?: string;
  onSuccessClick: () => void;
  onClose: () => void;
  onErrorClick: () => void;
}) {
  useEffect(function logFallbackWarning() {
    // Log warning when fallback is triggered - helps identify edge cases
    // where entitlementId is unexpectedly missing
    ClientLogBuffer.add({
      level: 'warn',
      event: 'credits.paywall.fallback',
      data: {
        reason: 'missing_entitlement_id',
        source,
        subscriptionId,
      },
    });
  }, [source, subscriptionId]);

  return (
    <SinglePlanUpgradeContainer
      source={source}
      onSuccessClick={onSuccessClick}
      onClose={onClose}
      onErrorClick={onErrorClick}
    />
  );
}

function ManagePlanContent() {
  const t = useTranslations();
  const gasketData = useGasketData();
  const locale = gasketData?.intl?.locale;
  const [showPaywallModal, setShowPaywallModal] = useState(false);
  const [paywallSource, setPaywallSource] = useState<string | null>(null);
  const [paywallType, setPaywallType] = useState<PaywallType>('upgrade');
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants');

  const openPaywall = (source: string, type: PaywallType = 'upgrade') => {
    setPaywallSource(source);
    setPaywallType(type);
    setShowPaywallModal(true);
    shipAnalyticsLog(`${source}.shown`, { paywallType: type });
  };

  const closePaywall = () => {
    setShowPaywallModal(false);
  };

  useEffect(function logPageView() {
    logImpressionEvent('manage_plan.page.view')();
  }, []);

  const {
    data: subscription,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscription();

  const {
    data: grantsData,
    isLoading: isGrantsLoading,
    isError: isGrantsError,
  } = useCreditGrants({
    subscriptionId: subscription?.id,
  });

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

  const grants: CreditGrant[] = grantsData || [];

  const monthlyGrant = getMonthlyPlanGrant(grants);
  const creditPacks = getCreditPackGrants(grants);
  const activeGrant = getActiveGrant(grants);

  const currentPlan = getPlanFromSubscription(subscription);
  const planLabelKey = getPlanDisplayLabelKey(currentPlan);
  const planDisplayLabel = planLabelKey ? t(planLabelKey) : '';
  const isFreePlan = currentPlan === SubscriptionPlan.Free;
  const hasCreditsNoPlan = creditPacks.length > 0 && isFreePlan;
  const paywallSourceId = paywallSource ?? 'manage_plan';

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

  // Get builder entitlement ID for credits purchase
  const builderEntitlementId = subscription?.builderEntitlementId;

  return (
    <>
      {/* Upgrade Modal (for plan upgrades) */}
      {showPaywallModal && paywallType === 'upgrade' && (
        <SinglePlanUpgradeContainer
          source={paywallSourceId}
          onSuccessClick={() => {
            closePaywall();
          }}
          onClose={() => {
            closePaywall();
            shipAnalyticsLog(`${paywallSourceId}.dismissed`, {});
          }}
          onErrorClick={() => {
            closePaywall();
            shipAnalyticsLog(`${paywallSourceId}.error`, {});
          }}
        />
      )}

      {/* Credits Modal (for credits purchase) */}
      {showPaywallModal && paywallType === 'credits' && builderEntitlementId && (
        <CreditsUpgradeContainer
          source={paywallSourceId}
          entitlementId={builderEntitlementId}
          onSuccess={() => {
            closePaywall();
          }}
          onClose={() => {
            closePaywall();
            shipAnalyticsLog(`${paywallSourceId}.dismissed`, {});
          }}
          onErrorClick={() => {
            closePaywall();
            shipAnalyticsLog(`${paywallSourceId}.error`, {});
          }}
        />
      )}

      {/* Fallback: Show upgrade modal for credits when entitlementId is missing */}
      {showPaywallModal && paywallType === 'credits' && !builderEntitlementId && (
        <CreditsPaywallFallback
          source={paywallSourceId}
          subscriptionId={subscription?.id}
          onSuccessClick={() => {
            closePaywall();
          }}
          onClose={() => {
            closePaywall();
            shipAnalyticsLog(`${paywallSourceId}.dismissed`, {});
          }}
          onErrorClick={() => {
            closePaywall();
            shipAnalyticsLog(`${paywallSourceId}.error`, {});
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
                        onClick={() => openPaywall('manage_plan.upgrade', 'upgrade')}
                    />
                )}
                { creditPacks.length > 0 && (
                    <Button
                        design="secondary"
                        data-partial='componentAiro'
                        data-eid={generateClickEID('manage_plan.buy_credits')}
                        size="sm"
                        text={t('builder_manageplan_buy_credits')}
                        onClick={() => openPaywall('manage_plan.buy_credits', 'credits')}
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
                subscriptionPlan={currentPlan}
                activeGrantId={activeGrant?.id}
                locale={locale}
                onOpenPaywall={openPaywall}
                isGrantsEnabled={isGrantsEnabled}
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
