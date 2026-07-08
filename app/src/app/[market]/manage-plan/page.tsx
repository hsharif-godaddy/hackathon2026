"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormattedMessage } from "react-intl";
import Alert from "@ux/alert";
import Button from "@ux/button";
import text from "@ux/text";

import {
  CdsEsmPreload,
  CreditsUpgradeContainer,
  GrantPollingModal,
  RenewalPollingModal,
  UpgradeContainer,
  UpgradePollingModal,
} from "@/app/[market]/develop/components/paywall";
import {
  AddonCreditCard,
  AppsAndSitesCard,
  DowngradeModal,
  FreeAutoRenewAlert,
  ManagePlanSkeleton,
  NewAccountZeroState,
  PageLayout,
  SuspendedNonPaymentAlert,
  TotalCreditsCard,
} from "@/app/[market]/manage-plan/components";
import {
  ManagePlanLayout,
  ManagePlanSkeletonV2,
} from "@/app/[market]/manage-plan/components/v2";
import { ProtectedRoute } from "@/components/auth";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useCreditGrants } from "@/hooks/useCreditGrants";
import { useIsCreditPolling } from "@/hooks/useCreditPurchase";
import { useCreditsDeeplink } from "@/hooks/useCreditsDeeplink";
import { useEcommSubscriptionAutoRenew } from "@/hooks/useEcommSubscriptionAutoRenew";
import { useEcommSubscriptionAutoRenewStatus } from "@/hooks/useEcommSubscriptionAutoRenewStatus";
import { useGasketData } from "@/hooks/useGasketData";
import { usePaywallDeeplink } from "@/hooks/usePaywallDeeplink";
import {
  useIsRenewalPolling,
  useSubscriptionRenewal,
} from "@/hooks/useSubscriptionRenewal";
import { useSubscriptionWithPolling } from "@/hooks/useSubscriptionWithPolling";
import { useSwitchboard } from "@/hooks/useSwitchboard";
import { useTranslations } from "@/hooks/useTranslations";
import { useIsUpgradePolling } from "@/hooks/useUpgradePurchase";
import { ClientLogBuffer, shipAnalyticsLog } from "@/lib/logging";
import {
  isPaidPlanForGrants,
  PAYWALL_ITC,
  PAYWALL_TYPE,
  type PaywallType,
} from "@/lib/paywall/shared";
import { getPublishLimit, isPublishedApp } from "@/lib/publish-limit";
import { usePaywallStore } from "@/stores/usePaywallStore";
import { useSites } from "@/stores/useSitesStore";
import type { CreditGrant } from "@/types/credits";
import {
  SubscriptionStatus,
  SubscriptionSuspendReason,
} from "@/types/credits";
import {
  getActiveGrant,
  getCreditPackGrants,
  getEffectiveCreditsSpent,
  getMonthlyPlanGrant,
  getPlanDisplayLabelKey,
  getPlanFromSubscription,
} from "@/utils/credits";
import { getRootDomain } from "@/utils/getRootDomain";
import { generateClickEID, logImpressionEvent } from "@/utils/instrumentation";
import DowngradeScheduledAlert from "./components/alerts/DowngradeAlert";
import PlanCreditsCard from "./components/PlanCreditsCard";

/**
 * Safely parse a date string, returning null if invalid
 */
function parseDate(dateString?: string): Date | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    console.warn("Invalid date string received:", dateString);
    return null;
  }
  return date;
}

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
  itc,
}: {
  source: string;
  subscriptionId?: string;
  onSuccessClick: () => void;
  onClose: () => void;
  onErrorClick: () => void;
  itc?: string;
}) {
  useEffect(
    function logFallbackWarning() {
      // Log warning when fallback is triggered - helps identify edge cases
      // where entitlementId is unexpectedly missing
      ClientLogBuffer.add({
        level: "warn",
        event: "credits.paywall.fallback",
        data: {
          reason: "missing_entitlement_id",
          source,
          subscriptionId,
        },
      });
    },
    [source, subscriptionId],
  );

  return (
    <UpgradeContainer
      source={source}
      itc={itc}
      onSuccessClick={onSuccessClick}
      onClose={onClose}
      onErrorClick={onErrorClick}
    />
  );
}

function ManagePlanContent() {
  const t = useTranslations();
  const router = useRouter();
  const gasketData = useGasketData();
  const locale = gasketData?.intl?.locale;
  const rootDomain = getRootDomain() || "godaddy.com";
  const showUpgradeModal = usePaywallStore((state) => state.showUpgradeModal);
  const upgradeModalSource = usePaywallStore((state) => state.upgradeModalSource);
  const upgradeModalItc = usePaywallStore((state) => state.upgradeModalItc);
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);
  const closeUpgradeModal = usePaywallStore((state) => state.closeUpgradeModal);
  const showCreditsModal = usePaywallStore((state) => state.showCreditsModal);
  const creditsModalSource = usePaywallStore((state) => state.creditsModalSource);
  const creditsModalItc = usePaywallStore((state) => state.creditsModalItc);
  const openCreditsModal = usePaywallStore((state) => state.openCreditsModal);
  const closeCreditsModal = usePaywallStore((state) => state.closeCreditsModal);
  const [showSwitchToFreeModal, setShowSwitchToFreeModal] = useState(false);
  const [isDowngradeAlertDismissed, setIsDowngradeAlertDismissed] =
    useState(false);
  const [isFreeAutoRenewAlertDismissed, setIsFreeAutoRenewAlertDismissed] =
    useState(false);
  const [isSuspendedAlertDismissed, setIsSuspendedAlertDismissed] =
    useState(false);
  const { setAutoRenew } = useEcommSubscriptionAutoRenew();
  const isCreditPolling = useIsCreditPolling();
  const isUpgradePolling = useIsUpgradePolling();
  const isRenewalPolling = useIsRenewalPolling();
  const {
    renewSubscription,
    error: renewalError,
    resetError: resetRenewalError,
  } = useSubscriptionRenewal();
  const isUnpublishEnabled = useSwitchboard("appbuilder-unpublish");
  const isSuspendedBannerEnabled = useSwitchboard("appbuilder-suspended-nonpayment-banner");
  const isManagePlanRedesignFlagEnabled: boolean | undefined = useSwitchboard("aab-manage-plan-redesign");
  const isRedesignEnabled: boolean = isManagePlanRedesignFlagEnabled === true;
  const paywallLoading = usePaywallStore((state) => state.paywallLoading);
  const openPaywall = useCallback(
    (source: string, type: PaywallType = "upgrade", itc?: string) => {
      if (paywallLoading) return
      if (type === PAYWALL_TYPE.UPGRADE) {
        openUpgradeModal(source, itc)
      } else {
        openCreditsModal(source, itc)
      }
      shipAnalyticsLog(`${source}.shown`, { paywallType: type });
    },
    [paywallLoading, openUpgradeModal, openCreditsModal]
  );

  useEffect(function logPageView() {
    logImpressionEvent("manage_plan.page.view")();
  }, []);

  // Subscription with automatic polling when grants enabled but entitlement not yet available
  const {
    subscription,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    builderEntitlementId,
  } = useSubscriptionWithPolling();

  const {
    data: grantsData,
    isLoading: isGrantsLoading,
    isError: isGrantsError,
  } = useCreditGrants({
    subscriptionId: subscription?.id,
  });

  const { data: autoRenewStatus } =
    useEcommSubscriptionAutoRenewStatus(builderEntitlementId);

  const { sites, isLoading: isSitesLoading } = useSites({
    enabled: isUnpublishEnabled === true || isRedesignEnabled,
  });

  const publishedCount: number = useMemo(
    () => (sites ?? []).filter(isPublishedApp).length,
    [sites],
  );

  // Next.js shares the route bundle across all /develop/[id] routes,
  // so one prefetch warms the cache for every row.
  const firstSiteId = sites?.[0]?.id;
  useEffect(function prefetchDevelopRoute() {
    if (firstSiteId) {
      router.prefetch(`/develop/${firstSiteId}`);
    }
  }, [router, firstSiteId]);

  const { totalCreditsSpent, totalCreditsMax } = useMemo(
    function calculateTotalCredits() {
      const grants = grantsData || [];
      return grants.reduce(
        function sumCredits(acc, grant) {
          return {
            totalCreditsSpent:
              acc.totalCreditsSpent +
              getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
            totalCreditsMax: acc.totalCreditsMax + grant.creditsMax,
          };
        },
        { totalCreditsSpent: 0, totalCreditsMax: 0 },
      );
    },
    [grantsData],
  );

  usePaywallDeeplink({
    openPaywall,
    enabled: !isSubscriptionLoading && !isSubscriptionError,
  });

  const openCredits = useCallback(
    (source: string) => openPaywall(source, PAYWALL_TYPE.CREDITS, PAYWALL_ITC.CREDITS),
    [openPaywall],
  );

  useCreditsDeeplink({
    openCredits,
    enabled: !isSubscriptionLoading && !isSubscriptionError,
  });

  if (isSubscriptionLoading || isGrantsLoading) {
    return (
      <PageLayout>
        {isRedesignEnabled ? <ManagePlanSkeletonV2 /> : <ManagePlanSkeleton />}
      </PageLayout>
    );
  }

  if (isSubscriptionError || isGrantsError) {
    return (
      <PageLayout>
        <text.p
          as="paragraph"
          className="text-center"
          text={t("builder_manageplan_error")}
        />
      </PageLayout>
    );
  }

  if (!subscription) {
    return (
      <PageLayout>
        <NewAccountZeroState />
      </PageLayout>
    );
  }

  const grants: CreditGrant[] = grantsData || [];

  const planGrant = getMonthlyPlanGrant(grants);
  const creditPacks = getCreditPackGrants(grants);
  const activeGrant = getActiveGrant(grants);

  const currentPlan = getPlanFromSubscription(subscription);
  const paywallSourceId = upgradeModalSource ?? creditsModalSource ?? "manage_plan";

  const isPaidPlan = isPaidPlanForGrants(currentPlan);
  const planLabelKey = getPlanDisplayLabelKey(currentPlan);
  const planDisplayLabel = planLabelKey ? t(planLabelKey) : "";

  const paidThroughDate = autoRenewStatus?.paidThroughDate;
  const parsedPaidThroughDate = parseDate(paidThroughDate);

  // Check if subscription was updated within the last 2 minutes (recent plan change).
  // This handles the race condition where a user upgrades from Free to Paid,
  // but autoRenew hasn't synced yet (still false). We suppress the downgrade
  // banner during this window to avoid a confusing false-positive.
  const RECENT_PLAN_CHANGE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
  const subscriptionUpdatedAt = subscription?.updatedAt
    ? parseDate(subscription.updatedAt)
    : null;
  const isRecentPlanChange =
    subscriptionUpdatedAt !== null &&
    Date.now() - subscriptionUpdatedAt.getTime() <
      RECENT_PLAN_CHANGE_THRESHOLD_MS;

  // When the user explicitly set autoRenew=false in this session (clicked "Switch to Free"),
  // bypass the isRecentPlanChange guard and treat autoRenew as disabled immediately.
  const hasPendingDowngrade =
    setAutoRenew.isSuccess && setAutoRenew.variables?.autoRenew === false;

  const isAutoRenewDisabled =
    autoRenewStatus?.autoRenew === false || hasPendingDowngrade;
  const showFreeAutoRenewAlert =
    !isFreeAutoRenewAlertDismissed &&
    isPaidPlan &&
    isAutoRenewDisabled &&
    (!isRecentPlanChange || hasPendingDowngrade);

  // Show DowngradeScheduledAlert when downgradedAt and downgradedPlan are present
  // This indicates the user has scheduled a downgrade to a different plan
  const hasScheduledDowngrade =
    subscription?.downgradedAt && subscription?.downgradedPlan;
  const showDowngradeScheduledAlert =
    !isDowngradeAlertDismissed && hasScheduledDowngrade;

  // Show SuspendedNonPaymentAlert when subscription is suspended due to non-payment
  const isSuspendedForNonPayment =
    isSuspendedBannerEnabled &&
    subscription?.status === SubscriptionStatus.Suspended &&
    subscription?.reason === SubscriptionSuspendReason.NonPayment;
  const showSuspendedAlert =
    !isSuspendedAlertDismissed && isSuspendedForNonPayment;

  const handleRenew = async () => {
    if (!autoRenewStatus?.subscriptionId) {
      return;
    }
    await renewSubscription(autoRenewStatus.subscriptionId);
  };

  const mutationError = setAutoRenew.error;

  return (
    <>
      {/* Upgrade Modal (for plan upgrades) */}
      {showUpgradeModal && (
        <UpgradeContainer
          source={upgradeModalSource ?? paywallSourceId}
          itc={upgradeModalItc ?? undefined}
          onSuccessClick={closeUpgradeModal}
          onClose={() => {
            closeUpgradeModal();
            shipAnalyticsLog(`${paywallSourceId}.dismissed`, {});
          }}
          onErrorClick={() => {
            closeUpgradeModal();
            shipAnalyticsLog(`${paywallSourceId}.error`, {});
          }}
        />
      )}

      {/* Credits Modal (for credits purchase) */}
      {showCreditsModal &&
        builderEntitlementId &&
        subscription?.id && (
          <div data-testid="credits-modal-container">
            <CreditsUpgradeContainer
              source={creditsModalSource ?? paywallSourceId}
              entitlementId={builderEntitlementId}
              subscriptionId={subscription.id}
              initialGrantCount={grants.length}
              itc={creditsModalItc ?? undefined}
              onSuccess={() => {
                closeCreditsModal();
              }}
              onClose={() => {
                closeCreditsModal();
                shipAnalyticsLog(`${paywallSourceId}.dismissed`, {});
              }}
              onErrorClick={() => {
                closeCreditsModal();
                shipAnalyticsLog(`${paywallSourceId}.error`, {});
              }}
            />
          </div>
        )}

      {/* Fallback: Show upgrade modal for credits when entitlementId is missing */}
      {showCreditsModal &&
        !builderEntitlementId && (
          <CreditsPaywallFallback
            source={creditsModalSource ?? paywallSourceId}
            subscriptionId={subscription?.id}
            itc={creditsModalItc ?? undefined}
            onSuccessClick={() => {
              closeCreditsModal();
            }}
            onClose={() => {
              closeCreditsModal();
              shipAnalyticsLog(`${paywallSourceId}.dismissed`, {});
            }}
            onErrorClick={() => {
              closeCreditsModal();
              shipAnalyticsLog(`${paywallSourceId}.error`, {});
            }}
          />
        )}

      {showSwitchToFreeModal && builderEntitlementId && (
        <DowngradeModal
          planName={planDisplayLabel}
          planCreditsMax={planGrant?.creditsMax ?? 0}
          onClose={() => setShowSwitchToFreeModal(false)}
          onConfirm={() => {
            setAutoRenew.mutate(
              { builderEntitlementId, autoRenew: false },
              {
                onSuccess: () => {
                  setShowSwitchToFreeModal(false);
                  setIsDowngradeAlertDismissed(false);
                  setIsFreeAutoRenewAlertDismissed(false);
                  // Log cancellation success impression for grant tracking
                  logImpressionEvent("plan.cancellation.success")();
                  shipAnalyticsLog("plan.cancellation.success", {
                    fromPlan: currentPlan,
                  });
                },
              },
            );
          }}
          isLoading={setAutoRenew.isPending}
          error={setAutoRenew.error}
        />
      )}

      <PageLayout>
        {mutationError && (
          <div className="mb-4">
            <Alert
              emphasis="critical"
              title={t("builder_manageplan_downgrade_error_title")}
              onClose={() => setAutoRenew.reset()}
              actions={
                builderEntitlementId ? (
                  <Button
                    design="inline"
                    size="sm"
                    data-partial="componentAiro"
                    data-eid={generateClickEID(
                      "manageplan.buttons.downgrade_retry",
                    )}
                    text={t("builder_manageplan_downgrade_retry")}
                    onClick={() =>
                      setAutoRenew.mutate({
                        builderEntitlementId,
                        autoRenew: false,
                      })
                    }
                    disabled={setAutoRenew.isPending}
                  />
                ) : undefined
              }
            >
              {t("builder_manageplan_downgrade_error_message")}
            </Alert>
          </div>
        )}
        {/* Priority 1: Suspended non-payment alert */}
        {showSuspendedAlert && (
          <SuspendedNonPaymentAlert
            planName={planDisplayLabel}
            renewsAt={subscription?.renewsAt}
            onRenew={handleRenew}
            onDismiss={() => setIsSuspendedAlertDismissed(true)}
            isRenewing={isRenewalPolling}
            error={renewalError}
            onErrorDismiss={resetRenewalError}
          />
        )}
        {/* Priority 2: Downgrade scheduled alert */}
        {showDowngradeScheduledAlert && !showSuspendedAlert && (
          <DowngradeScheduledAlert
            onKeepPlan={() => {
              openPaywall("manage_plan.switch_to_current_plan", "upgrade");
            }}
            onDismiss={() => setIsDowngradeAlertDismissed(true)}
          />
        )}
        {/* Priority 3: Free auto-renew alert */}
        {showFreeAutoRenewAlert &&
          !showDowngradeScheduledAlert &&
          !showSuspendedAlert && (
            <FreeAutoRenewAlert
              renewalDate={parsedPaidThroughDate?.toISOString()}
              planName={planDisplayLabel}
              onCancelChanges={
                isAutoRenewDisabled && builderEntitlementId
                  ? () =>
                      setAutoRenew.mutate({
                        builderEntitlementId,
                        autoRenew: true,
                      })
                  : undefined
              }
              isLoading={setAutoRenew.isPending}
              onDismiss={() => setIsFreeAutoRenewAlertDismissed(true)}
            />
          )}
        {isRedesignEnabled ? (
          <ManagePlanLayout
            planGrant={planGrant}
            creditPacks={creditPacks}
            activeGrantId={activeGrant?.id}
            locale={locale}
            openPaywall={openPaywall}
            onDowngradeClick={() => setShowSwitchToFreeModal(true)}
            sites={sites}
            isSitesLoading={isSitesLoading}
            currentPlan={currentPlan}
            publishedCount={publishedCount}
            publishLimit={getPublishLimit(currentPlan)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <text.h2 as="title" size={3} text={t("builder_manageplan_title")} />
            <text.p as="paragraph" className="mb-2">
              <FormattedMessage
                id="builder_manageplan_description_help"
                values={{
                  creditLink: (chunks) => (
                    <a
                      href={`https://www.${rootDomain}/help/godaddy-airo-ai-builder-credits-faq-42828`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-ai-light"
                    >
                      {chunks}
                    </a>
                  ),
                  promptLink: (chunks) => (
                    <a
                      href={`https://www.${rootDomain}/help/godaddy-airo-ai-builder-prompt-best-practices-42854`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-ai-light"
                    >
                      {chunks}
                    </a>
                  ),
                }}
              />
            </text.p>

            <div className="grid grid-cols-1 md:grid-cols-12 md:items-start gap-4">
              <div className="md:col-span-3 md:min-h-0">
                <TotalCreditsCard
                  totalCreditsSpent={totalCreditsSpent}
                  totalCreditsMax={totalCreditsMax}
                />
              </div>

              <div className="flex flex-col gap-4 md:col-span-9 md:min-h-0">
                <PlanCreditsCard
                  subscription={subscription}
                  planGrant={planGrant}
                  activeGrantId={activeGrant?.id}
                  locale={locale}
                  creditPacks={creditPacks}
                  openPaywall={openPaywall}
                  autoRenewStatus={autoRenewStatus}
                  onDowngradeClick={() => setShowSwitchToFreeModal(true)}
                />
                {currentPlan && (
                  <AddonCreditCard
                    creditPacks={creditPacks}
                    subscriptionPlan={currentPlan}
                    activeGrantId={activeGrant?.id}
                    locale={locale}
                    onOpenPaywall={openPaywall}
                    builderEntitlementId={builderEntitlementId}
                  />
                )}
                {isUnpublishEnabled && (
                  <AppsAndSitesCard
                    sites={sites}
                    isLoading={isSitesLoading}
                    subscriptionPlan={currentPlan}
                    hadAiroPlus={subscription?.hadAiroPlus}
                    onOpenPaywall={openPaywall}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </PageLayout>

      {/* Polling overlay while waiting for new grant after credit purchase */}
      {isCreditPolling && <GrantPollingModal />}

      {/* Polling overlay while waiting for plan change after upgrade purchase */}
      {isUpgradePolling && <UpgradePollingModal />}

      {/* Polling overlay while waiting for subscription renewal */}
      {isRenewalPolling && <RenewalPollingModal />}

      <ErrorBoundary fallback={() => null}>
        <CdsEsmPreload />
      </ErrorBoundary>
    </>
  );
}

export default function ManagePlan() {
  const router = useRouter();
  const isFeatureEnabled = useSwitchboard("appbuilder-manage-plan");

  useEffect(
    function redirectIfDisabled() {
      if (isFeatureEnabled === false) {
        router.replace("/");
      }
    },
    [isFeatureEnabled, router],
  );

  if (!isFeatureEnabled) {
    return (
      <PageLayout>
        <ManagePlanSkeleton />
      </PageLayout>
    );
  }

  return (
    <ProtectedRoute>
      <ManagePlanContent />
    </ProtectedRoute>
  );
}
