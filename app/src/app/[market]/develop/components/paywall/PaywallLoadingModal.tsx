'use client'

import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import Modal from '@ux/modal'
import Skeleton from '@ux/skeleton'
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
}

function SkeletonPlanCard() {
  return (
    <div
      data-testid="skeleton-plan-card"
      className="flex flex-col p-8 w-full gap-3 border border-intents-ux-box-borderColor rounded-2xl"
    >
      <Skeleton size="lg" width="120px" height="28px" />
      <Skeleton size="md" width="180px" height="24px" className="mt-1" />
      <Skeleton size="md" width="140px" height="20px" />
      <Skeleton size="lg" width="160px" height="48px" className="my-2" />
      <Skeleton size="sm" width="240px" height="20px" />
      <Skeleton size="sm" width="200px" height="16px" />
      <Skeleton size="lg" width="100%" height="48px" className="my-3" />
      <Skeleton size="sm" width="80%" height="20px" />
      <Skeleton size="sm" width="80%" height="20px" />
      <Skeleton size="sm" width="80%" height="20px" />
      <Skeleton size="sm" width="80%" height="20px" />
      <Skeleton size="sm" width="80%" height="20px" />
    </div>
  )
}

/**
 * Loading skeleton shown while CDS/UPP loads.
 * HigherPlans variant uses the same @ux/modal props as UPP's Shell component
 * (id='upgrade-modal', stretch, title='').
 *
 * Renders to document.body (default @ux/modal behavior), NOT into
 * #UpgradeLibraryPortal. Portal reuse was investigated and causes a crash:
 * two React trees managing the same DOM element with uncoordinated cleanup
 * during CDS's LoadingComponent-to-RemoteMyComponent swap.
 */
export function PaywallLoadingModal({
  onClose,
  variant = PaywallLoadingModalVariant.Default,
  source,
  component,
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
      >
        <div
          className="flex flex-col items-center w-full mx-auto max-w-[1280px] px-6 py-10"
        >
          <Skeleton size="lg" width="340px" height="36px" />
          <Skeleton size="md" width="420px" height="20px" className="mt-3" />
          <Skeleton size="md" width="280px" height="40px" className="mt-4 rounded-full" />
          <div
            className="w-full mt-10 grid grid-cols-3 gap-x-4"
          >
            <SkeletonPlanCard />
            <SkeletonPlanCard />
            <SkeletonPlanCard />
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title=""
      onClose={onClose}
      centered
    >
      <Box className="flex items-center justify-center py-8 min-h-48 min-w-48">
        <Spinner size="lg" />
      </Box>
    </Modal>
  )
}
