'use client'

import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'

import { shipAnalyticsLog } from '@/lib/logging'

export enum PaywallLoadingModalVariant {
  Default = 'default',
  HigherPlans = 'higher-plans',
  Credits = 'credits',
}

interface PaywallLoadingModalProps {
  onClose: () => void
  variant?: PaywallLoadingModalVariant
  source?: string
  component?: string
  focusLock?: boolean
}


function SkeletonPlanBox() {
  return (
    <div
      data-testid="skeleton-plan-card"
      className="grid rounded-lg border border-[rgb(214,214,214)] bg-white"
      style={{ padding: '24px 24px 0' }}
    >
      <div className="skeleton-shimmer" style={{ width: '50%', height: '96px', margin: '16px 0' }} />
      <div className="skeleton-shimmer" style={{ width: '66%', height: '40px', margin: '16px 0' }} />
      <div className="skeleton-shimmer" style={{ width: '50%', height: '56px', margin: '16px 0' }} />
      <div className="skeleton-shimmer" style={{ width: '100%', height: '32px', margin: '16px 0 8px' }} />
      <div className="skeleton-shimmer" style={{ width: '100%', height: '24px', margin: '8px 0 0' }} />
      <div className="skeleton-shimmer-dark" style={{ width: '100%', height: '56px', margin: '48px 0' }} />
      <div className="skeleton-shimmer" style={{ width: '50%', height: '40px', margin: '8px 0' }} />
      <div className="skeleton-shimmer" style={{ width: '100%', height: '24px', margin: '8px 0' }} />
      <div className="skeleton-shimmer" style={{ width: '100%', height: '24px', margin: '8px 0' }} />
    </div>
  )
}

/**
 * Loading skeleton matching UPP's NearStar PlanBox skeleton exactly.
 * Computed styles captured from live UPP DOM in test env (2026-06-05).
 * Renders to document.body via @ux/modal, NOT into #UpgradeLibraryPortal.
 */
export function PaywallLoadingModal({
  onClose,
  variant = PaywallLoadingModalVariant.Default,
  source,
  component,
  focusLock,
}: PaywallLoadingModalProps) {
  const hasLoggedRef = useRef(false)

  useEffect(() => {
    if (!hasLoggedRef.current) {
      hasLoggedRef.current = true
      shipAnalyticsLog(`paywall.loading.${variant}.shown`, {
        source,
        component,
        variant,
      })
    }
  }, [variant, source, component])

  if (variant === PaywallLoadingModalVariant.HigherPlans) {
    return (
      <Modal
        id="upgrade-modal"
        title=""
        onClose={onClose}
        stretch
        focusLock={focusLock}
      >
        <div className="grid grid-cols-3 gap-x-4" style={{ padding: '12px 0 40px' }}>
          <SkeletonPlanBox />
          <SkeletonPlanBox />
          <SkeletonPlanBox />
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title=""
      onClose={onClose}
      centered
      focusLock={focusLock}
    >
      <Box className="flex items-center justify-center py-8 min-h-48 min-w-48">
        <Spinner size="lg" />
      </Box>
    </Modal>
  )
}
