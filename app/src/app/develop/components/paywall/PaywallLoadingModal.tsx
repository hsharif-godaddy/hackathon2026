'use client'

import Box from '@ux/box'
import Modal from '@ux/modal'
import Skeleton from '@ux/skeleton'
import Spinner from '@ux/spinner'

/** Variants for PaywallLoadingModal layouts */
export enum PaywallLoadingModalVariant {
  Default = 'default',
  HigherPlans = 'higher-plans',
}

interface PaywallLoadingModalProps {
  onClose: () => void
  /** Variant for different modal layouts */
  variant?: PaywallLoadingModalVariant
}

/**
 * Skeleton plan card shown while higher plans modal loads
 */
function SkeletonPlanCard() {
  return (
    <div
      data-testid="skeleton-plan-card"
      className="flex flex-col items-center p-2 border border-intents-ux-boxLowContrast-borderColor rounded-lg w-full lg:w-[350px] gap-2"
    >
      {/* Plan name - extra-tall height, half width */}
      <Skeleton size="lg" width="180px" height="96px" />
      {/* Credits badge - medium height, large width */}
      <Skeleton size="md" width="220px" height="40px" className="mt-1" />
      {/* Description - tall height, half width */}
      <Skeleton size="md" width="160px" height="56px" className="my-2" />
      {/* Price - short height, full width */}
      <Skeleton size="sm" width="280px" height="32px" />
      {/* Billing period - extra-short height, full width */}
      <Skeleton size="sm" width="280px" height="24px" />
      {/* CTA button - tall height, full width */}
      <Skeleton size="lg" width="280px" height="56px" className="my-4" />
      {/* Feature list */}
      <Skeleton size="md" width="160px" height="40px" />
      <Skeleton size="sm" width="280px" height="24px" />
      <Skeleton size="sm" width="280px" height="24px" />
    </div>
  )
}

/**
 * Loading modal shown while CDS library loads
 */
export function PaywallLoadingModal({ onClose, variant = PaywallLoadingModalVariant.Default }: PaywallLoadingModalProps) {
  if (variant === PaywallLoadingModalVariant.HigherPlans) {
    return (
      <Modal
        title=""
        onClose={onClose}
        centered
        stretch
      >
        <div className="flex flex-col lg:flex-row gap-2 my-4 w-full max-w-screen-lg mx-auto">
          <SkeletonPlanCard />
          <SkeletonPlanCard />
          <SkeletonPlanCard />
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
