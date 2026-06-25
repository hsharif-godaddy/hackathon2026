'use client'

import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useEnterpriseManaged } from '@/hooks/useEnterpriseManaged'
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { canUpgradePlan, PAYWALL_ITC } from '@/lib/paywall/shared'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { getPlanFromSubscription } from '@/utils/credits'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

const STORAGE_KEY = 'airoplus_upgrade_banner_dismissed'

// Use local date (not UTC) so "today" matches user's timezone
// 'en-CA' locale reliably returns YYYY-MM-DD format which is sortable and unambiguous
function getLocalDateString(): string {
  return new Date().toLocaleDateString('en-CA')
}

function isDismissedToday(): boolean {
  return localStorage.getItem(STORAGE_KEY) === getLocalDateString()
}

function markDismissedToday(): void {
  localStorage.setItem(STORAGE_KEY, getLocalDateString())
}

interface UpgradeBannerProps {
  onDismiss?: () => void
}

export default function UpgradeBanner({ onDismiss }: UpgradeBannerProps) {
  const t = useTranslations()
  const [isDismissed, setIsDismissed] = useState(true)
  const [mounted, setMounted] = useState(false)
  const featureEnabled = useSwitchboard('appbuilder-airoplus-upgrade-banner')
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)
  const appId = useAppIdFromParams()
  const isSharedWithMe = useSiteStore((state) => (appId ? state.getSite(appId)?.sharedWithMe : false))
  const { isEnterpriseManaged } = useEnterpriseManaged()
  // Pass appId so an invited collaborator (owner-pays) bypasses the paywall.
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(appId)
  const { data: subscription } = useSubscription()
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : undefined

  const hasLoggedImpressionRef = useRef(false)

  // Check localStorage only after client-side mount to prevent hydration mismatch
  useEffect(() => {
    setIsDismissed(isDismissedToday())
    setMounted(true)
  }, [])

  // Invited users (sharedWithMe) are using the owner's subscription — never show the upgrade banner
  const shouldShowBanner = mounted && !isPaywallLoading && featureEnabled && !isDismissed &&
    !isSharedWithMe &&
    (showPaywall || canUpgradePlan(currentPlan))
  useEffect(() => {
    if (shouldShowBanner && !hasLoggedImpressionRef.current) {
      logImpressionEvent('chat.upgradeBanner.view')()
      hasLoggedImpressionRef.current = true
    }
  }, [shouldShowBanner])

  // Wait for loading, then show only if feature enabled and user can upgrade (non-Ultimate users).
  // Invited users (sharedWithMe) are on the owner's subscription — never show the upgrade banner.
  // `isSharedWithMe` must gate the actual render (not just the impression log above): the
  // canUpgradePlan branch can still be true for an invitee on a free plan, so without this an
  // invitee would see the banner even though showPaywall is bypassed.
  //
  // Enterprise-managed apps (`ownerProduct === 'aab-ent-v1'`) suppress the
  // banner entirely — the customer cannot self-serve a plan upgrade, so a
  // CTA to "Upgrade now" would dead-end. The contact-your-admin guidance
  // is surfaced via inline notices on the paywall touchpoints (Domain
  // panel, publish-limit modal, etc.) where it's contextually actionable.
  if (!mounted || isPaywallLoading || !featureEnabled || isDismissed || isSharedWithMe || isEnterpriseManaged ||
      (!showPaywall && !canUpgradePlan(currentPlan))) return null

  const handleClose = () => {
    logClickEvent('chat.upgradeBanner.close')()
    markDismissedToday()
    setIsDismissed(true)
    onDismiss?.()
  }

  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault()
    logClickEvent('chat.upgradeBanner.upgrade')()
    openUpgradeModal('airoplus_upgrade_banner.upgrade', PAYWALL_ITC.UPGRADE)
  }

  const link = (
    <a href="#" className="underline !cursor-pointer !normal-case" onClick={handleUpgradeClick}>
      {t('builder_airoplus_upgrade_link', {}, 'Upgrade now')}
    </a>
  )

  return (
    <ChatBanner variant="info" onClose={handleClose}>
      <FormattedMessage
        id="builder_airoplus_upgrade_message"
        values={{ link }}
      />
    </ChatBanner>
  )
}
