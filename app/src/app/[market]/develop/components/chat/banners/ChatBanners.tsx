'use client';

import { useState } from 'react';
import { isEmployeeAuthType } from '@airo/shared/auth';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useCreditThresholdEvents } from '@/hooks/useCreditThresholdEvents';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useUpgradeBannerExperiment } from '@/hooks/useUpgradeBannerExperiment';
import { useUsage } from '@/hooks/useUsage';
import {
  isPublishBlockedByComplianceRules,
  isSubscriptionSuspendedForNonPayment,
} from '@/lib/subscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import AgentWorkFeedbackBanner from './AgentWorkFeedbackBanner';
import AppGenerationFeedbackBanner from './AppGenerationFeedbackBanner';
import CampaignSuggestionBanner from './CampaignSuggestionBanner';
import FeedbackBanner from './FeedbackBanner';
import ImpersonationBanner from './ImpersonationBanner';
import SuspendedComplianceBanner from './SuspendedComplianceBanner';
import SuspendedNonPaymentBanner from './SuspendedNonPaymentBanner';
import UpgradeBanner from './UpgradeBanner';
import UsageWarningBanner from './UsageWarningBanner';

interface ChatBannersProps {
  appId: string | null;
}

/**
 * Container component that manages which chat banner to display.
 * Only one banner shows at a time, with priority order:
 * 0. ImpersonationBanner (e2s/e2s2s session — highest priority while shown, dismissible)
 * 1. SuspendedComplianceBanner (site suspended or account subscription non-compliant; Switchboard-gated)
 * 2. SuspendedNonPaymentBanner (subscription suspended for non-payment)
 * 3. UsageWarningBanner (remaining credits within warning threshold)
 * 4. UpgradeBanner (free users, control cohort only — treatment sees preview bar)
 * 5. FeedbackBanner (session-based NPS prompt)
 * 6. AppGenerationFeedbackBanner (thumbs up/down after first app generation; Switchboard-gated upstream in useAppGenerationFeedbackTrigger)
 * 7. AgentWorkFeedbackBanner (thumbs up/down after task completion signal; gated in useAgentWorkFeedbackTrigger)
 */
export default function ChatBanners({ appId }: ChatBannersProps) {
  const { tokenAuthType } = useAuthContext();
  const isImpersonating = isEmployeeAuthType(tokenAuthType);
  const { isWarningBannerActive } = useUsage({ appId, enabled: !!appId });
  useCreditThresholdEvents();
  const { showChatBanner: isUpgradeBannerActive, dismiss: dismissUpgradeBanner } = useUpgradeBannerExperiment(appId);
  const feedbackBannerEnabled = useSwitchboard('appbuilder-feedback-banner');
  const suspendedComplianceBannerEnabled = useSwitchboard('appbuilder-suspended-compliance-banner');
  const suspendedNonPaymentBannerEnabled = useSwitchboard('appbuilder-suspended-nonpayment-banner');
  const { data: subscription } = useSubscription();
  const showFeedbackBannerFromStore = useDevelopPageStore((state) => state.showFeedbackBanner);
  const showAppGenerationFeedbackBanner = useDevelopPageStore(
    (state) => state.showAppGenerationFeedbackBanner
  );
  const showAgentWorkFeedbackBanner = useDevelopPageStore(
    (state) => state.showAgentWorkFeedbackBanner
  );
  const [isImpersonationBannerDismissed, setIsImpersonationBannerDismissed] = useState(false);

  const currentSite = useSiteStore((state) => (appId ? state.getSite(appId) : null));

  const isSuspendedForCompliance =
    suspendedComplianceBannerEnabled &&
    isPublishBlockedByComplianceRules(currentSite, subscription, true);

  const isSuspendedForNonPayment =
    suspendedNonPaymentBannerEnabled && isSubscriptionSuspendedForNonPayment(subscription);

  // Determine if feedback banner should be shown (feature flag AND store state)
  const showFeedbackBanner: boolean = feedbackBannerEnabled === true && showFeedbackBannerFromStore;

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

  // Priority 4: Upgrade banner (control cohort only — treatment sees preview bar)
  if (isUpgradeBannerActive) {
    return <UpgradeBanner onDismiss={dismissUpgradeBanner} />;
  }

  // Priority 5: Feedback banner (only if feature flag is enabled)
  if (showFeedbackBanner) {
    return <FeedbackBanner />;
  }

  // Priority 6: App-generation feedback (thumbs up/down after first app generation).
  // Switchboard gating is upstream in useAppGenerationFeedbackTrigger — if the flag
  // is off, showAppGenerationFeedbackBanner never flips to true, so no render check here.
  if (showAppGenerationFeedbackBanner) {
    return <AppGenerationFeedbackBanner />;
  }

  // Priority 7: Agent-work feedback (task-completion follow-up).
  // Switchboard gating is upstream in useAgentWorkFeedbackTrigger.
  if (showAgentWorkFeedbackBanner) {
    return <AgentWorkFeedbackBanner />;
  }

  // Priority 8: Campaign suggestion (lowest — stays visible once shown until dismissed; hidden while NBA is active).
  // Switchboard gating and dismiss state are handled in useCampaignSuggestions, consumed by CampaignSuggestionBanner.
  return <CampaignSuggestionBanner />;
}
