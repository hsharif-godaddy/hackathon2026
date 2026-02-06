'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import text from '@ux/text';

import CreditsUpgradeContainer from '@/app/develop/components/CreditsUpgradeContainer';
import SinglePlanUpgradeContainer from '@/app/develop/components/SinglePlanUpgradeContainer';
import {
  AddonCreditCard,
  ManagePlanSkeleton,
  PageLayout,
  type PaywallType,
  TotalCreditsCard,
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
  getActiveGrant,
  getCreditPackGrants,
  getMonthlyPlanGrant,
  getPlanFromSubscription,
} from '@/utils/credits';
import { logImpressionEvent } from '@/utils/instrumentation';
import PlanCreditsCard from './components/PlanCreditsCard';

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

  // Memoize total credits calculation across all grants
  const { totalCreditsSpent, totalCreditsMax } = useMemo(
    function calculateTotalCredits() {
      const grants = grantsData || [];
      return grants.reduce(
        function sumCredits(acc, grant) {
          return {
            totalCreditsSpent: acc.totalCreditsSpent + grant.creditsSpent,
            totalCreditsMax: acc.totalCreditsMax + grant.creditsMax,
          };
        },
        { totalCreditsSpent: 0, totalCreditsMax: 0 }
      );
    },
    [grantsData]
  );

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
          <text.p as="paragraph" className="text-center" text={t('builder_manageplan_error')} />
      </PageLayout>
    );
  }

  const grants: CreditGrant[] = grantsData || [];

  const planGrant = getMonthlyPlanGrant(grants);
  const creditPacks = getCreditPackGrants(grants);
  const activeGrant = getActiveGrant(grants);

  const currentPlan = getPlanFromSubscription(subscription);
  const paywallSourceId = paywallSource ?? 'manage_plan';

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
        <div className="flex flex-col gap-2">
          <text.h2 as="title" size={3} text={t('builder_manageplan_title')} />
          <text.p as="paragraph" className="mb-2" text={t('builder_manageplan_description')} />
         
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <TotalCreditsCard
                totalCreditsSpent={totalCreditsSpent}
                totalCreditsMax={totalCreditsMax}
              />

            <div className='md:col-span-2 grid grid-cols-1 gap-4'>
              <PlanCreditsCard
                subscription={subscription}
                planGrant={planGrant}
                activeGrantId={activeGrant?.id}
                locale={locale}
                creditPacks={creditPacks}
                openPaywall={openPaywall}
              />
              {currentPlan !== SubscriptionPlan.AiroPlus && (
                <AddonCreditCard
                  creditPacks={creditPacks}
                  subscriptionPlan={currentPlan}
                  activeGrantId={activeGrant?.id}
                  locale={locale}
                  onOpenPaywall={openPaywall}
                  isGrantsEnabled={isGrantsEnabled}
                />
              )}
            </div>
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
