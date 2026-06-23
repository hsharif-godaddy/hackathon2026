'use client';

import { useCallback, useEffect, useState } from 'react';
import { isEmployeeAuthType } from '@airo/shared/auth';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useCreditThresholdEvents } from '@/hooks/useCreditThresholdEvents';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useUsage } from '@/hooks/useUsage';
import {
  isPublishBlockedByComplianceRules,
  isSubscriptionSuspendedForNonPayment,
} from '@/lib/subscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import AgentWorkFeedbackBanner from './AgentWorkFeedbackBanner';
import AppGenerationFeedbackBanner from './AppGenerationFeedbackBanner';
import FeedbackBanner from './FeedbackBanner';
import ImpersonationBanner from './ImpersonationBanner';
import SuspendedComplianceBanner from './SuspendedComplianceBanner';
import SuspendedNonPaymentBanner from './SuspendedNonPaymentBanner';
import UpgradeBanner from './UpgradeBanner';
import UsageWarningBanner from './UsageWarningBanner';

interface ChatBannersProps {
  appId: string | null;
}

const UPGRADE_BANNER_STORAGE_KEY = 'airoplus_upgrade_banner_dismissed';

function getLocalDateString(): string {
  return new Date().toLocaleDateString('en-CA');
}

function isUpgradeBannerDismissedToday(): boolean {
  return localStorage.getItem(UPGRADE_BANNER_STORAGE_KEY) === getLocalDateString();
}

/**
 * Container component that manages which chat banner to display.
 * Only one banner shows at a time, with priority order:
 * 0. ImpersonationBanner (e2s/e2s2s session — highest priority while shown, dismissible)
 * 1. SuspendedComplianceBanner (site suspended or account subscription non-compliant; Switchboard-gated)
 * 2. SuspendedNonPaymentBanner (subscription suspended for non-payment)
 * 3. UsageWarningBanner (remaining credits within warning threshold)
 * 4. UpgradeBanner (no Airo Plus subscription)
 * 5. FeedbackBanner (session-based NPS prompt)
 * 6. AppGenerationFeedbackBanner (thumbs up/down after first app generation; Switchboard-gated upstream in useAppGenerationFeedbackTrigger)
 * 7. AgentWorkFeedbackBanner (thumbs up/down after first file edit; gated in useAgentWorkFeedbackTrigger)
 */
export default function ChatBanners({ appId }: ChatBannersProps) {
  const { tokenAuthType } = useAuthContext();
  const isImpersonating = isEmployeeAuthType(tokenAuthType);
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId });
  useCreditThresholdEvents();
  const upgradeBannerEnabled = useSwitchboard('appbuilder-airoplus-upgrade-banner');
  const feedbackBannerEnabled = useSwitchboard('appbuilder-feedback-banner');
  const suspendedComplianceBannerEnabled = useSwitchboard('appbuilder-suspended-compliance-banner');
  const suspendedNonPaymentBannerEnabled = useSwitchboard('appbuilder-suspended-nonpayment-banner');
  // Pass appId so an invited collaborator (owner-pays) bypasses the paywall.
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(appId ?? undefined);
  const { data: subscription } = useSubscription();
  const showFeedbackBannerFromStore = useDevelopPageStore((state) => state.showFeedbackBanner);
  const showAppGenerationFeedbackBanner = useDevelopPageStore(
    (state) => state.showAppGenerationFeedbackBanner
  );
  const showAgentWorkFeedbackBanner = useDevelopPageStore(
    (state) => state.showAgentWorkFeedbackBanner
  );
  const [isImpersonationBannerDismissed, setIsImpersonationBannerDismissed] = useState(false);
  const [isUpgradeBannerDismissed, setIsUpgradeBannerDismissed] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Check localStorage only after client-side mount to prevent hydration mismatch
  useEffect(() => {
    setIsUpgradeBannerDismissed(isUpgradeBannerDismissedToday());
    setMounted(true);
  }, []);

  // Handle upgrade banner dismissal and update local state
  const handleUpgradeBannerDismiss = useCallback(() => {
    setIsUpgradeBannerDismissed(true);
  }, []);

  const currentSite = useSiteStore((state) => (appId ? state.getSite(appId) : null));

  const isSuspendedForCompliance =
    suspendedComplianceBannerEnabled &&
    isPublishBlockedByComplianceRules(currentSite, subscription, true);

  const isSuspendedForNonPayment =
    suspendedNonPaymentBannerEnabled && isSubscriptionSuspendedForNonPayment(subscription);

  // Determine if upgrade banner should be shown
  const isUpgradeBannerActive =
    mounted &&
    !isPaywallLoading &&
    upgradeBannerEnabled &&
    !isUpgradeBannerDismissed &&
    showPaywall;

  // Determine if feedback banner should be shown (feature flag AND store state)
  const showFeedbackBanner = mounted && feedbackBannerEnabled && showFeedbackBannerFromStore;

  // Priority 0: Impersonation banner (highest priority during e2s/e2s2s sessions, dismissible)
  if (isImpersonating && !isImpersonationBannerDismissed) {
    return <ImpersonationBanner onClose={() => setIsImpersonationBannerDismissed(true)} />;
  }

  // Priority 1: Suspended compliance (critical - user needs to contact support)
  if (isSuspendedForCompliance) {
    return <SuspendedComplianceBanner />;
  }

  // Priority 2: Suspended non-payment (critical - user needs to renew)
  if (isSuspendedForNonPayment) {
    return (
      <SuspendedNonPaymentBanner
        builderEntitlementId={subscription?.builderEntitlementId}
        renewsAt={subscription?.renewsAt}
      />
    );
  }

  // Priority 3: Usage warning takes precedence over upgrade prompt
  if (isWarningBannerActive) {
    return <UsageWarningBanner appId={appId} />;
  }

  // Priority 4: Upgrade banner
  if (isUpgradeBannerActive) {
    return <UpgradeBanner onDismiss={handleUpgradeBannerDismiss} />;
  }

  // Priority 5: Feedback banner (only if feature flag is enabled)
  if (showFeedbackBanner) {
    return <FeedbackBanner />;
  }

  // Priority 6: App-generation feedback (thumbs up/down after first app generation).
  // Switchboard gating is upstream in useAppGenerationFeedbackTrigger — if the flag
  // is off, showAppGenerationFeedbackBanner never flips to true, so no render check here.
  if (mounted && showAppGenerationFeedbackBanner) {
    return <AppGenerationFeedbackBanner />;
  }

  // Priority 7: Agent-work feedback (how did the agent perform?).
  // Switchboard gating is upstream in useAgentWorkFeedbackTrigger.
  if (mounted && showAgentWorkFeedbackBanner) {
    return <AgentWorkFeedbackBanner />;
  }

  return null;
}
