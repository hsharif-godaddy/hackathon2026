'use client'

import Box from '@ux/box'
import Modal from '@ux/modal'
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
    <div className="flex flex-col gap-3 p-4 border border-intents-ux-boxLowContrast-borderColor rounded-lg min-w-[200px]">
      {/* Plan name skeleton */}
      <div className="h-6 w-24 bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse mx-auto" />
      {/* Price skeleton */}
      <div className="h-5 w-20 bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse mx-auto" />
      {/* Billing period skeleton */}
      <div className="h-4 w-16 bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse mx-auto" />
      {/* Feature list skeletons */}
      <div className="flex flex-col gap-2 mt-2">
        <div className="h-4 w-full bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse" />
        <div className="h-4 w-full bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse" />
      </div>
      {/* CTA button skeleton */}
      <div className="h-10 w-full bg-intents-ux-boxLowContrast-backgroundColor rounded animate-pulse mt-2" />
      {/* Footer text skeletons */}
      <div className="h-3 w-24 bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse mx-auto mt-2" />
      <div className="flex flex-col gap-1">
        <div className="h-3 w-full bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse" />
        <div className="h-3 w-full bg-intents-ux-boxLowContrast-borderColor rounded animate-pulse" />
      </div>
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
      >
        <Box className="flex flex-col gap-6 p-6">
          {/* Plan cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonPlanCard />
            <SkeletonPlanCard />
            <SkeletonPlanCard />
          </div>
        </Box>
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
