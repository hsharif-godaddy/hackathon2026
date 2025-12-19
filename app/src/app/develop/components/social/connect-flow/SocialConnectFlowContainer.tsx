'use client'

import clsx from 'clsx'
import { memo, ReactNode } from 'react'

import { IconWithName } from '../shared/IconWithName'

export enum ContainerVariant {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
  Success = 'success'
}

export enum MaxWidth {
  Sm = 'sm',
  Md = 'md',
  Lg = 'lg',
  Xl = 'xl',
  Xl2 = '2xl',
  Xl3 = '3xl',
  Xl4 = '4xl'
}

interface SocialConnectFlowContainerProps {
  variant?: ContainerVariant
  icon?: React.ComponentType<{ className?: string }> | null
  platformName?: string
  showHeader?: boolean
  maxWidth?: MaxWidth
  children: ReactNode
}

const variantStyles: Record<ContainerVariant, { border: string; bg: string }> = {
  [ContainerVariant.Info]: {
    border: 'border-intents-ux-info-borderColor',
    bg: 'bg-intents-ux-info-backgroundColor'
  },
  [ContainerVariant.Warning]: {
    border: 'border-intents-ux-warning-borderColor',
    bg: 'bg-intents-ux-warning-backgroundColor'
  },
  [ContainerVariant.Error]: {
    border: 'border-intents-ux-error-borderColor',
    bg: 'bg-intents-ux-error-backgroundColor'
  },
  [ContainerVariant.Success]: {
    border: 'border-intents-ux-feedbackHighContrastSuccess-borderColor',
    bg: 'bg-intents-ux-feedbackHighContrastSuccess-backgroundColor'
  }
}

const maxWidthClasses: Record<MaxWidth, string> = {
  [MaxWidth.Sm]: 'max-w-sm',
  [MaxWidth.Md]: 'max-w-md',
  [MaxWidth.Lg]: 'max-w-lg',
  [MaxWidth.Xl]: 'max-w-xl',
  [MaxWidth.Xl2]: 'max-w-2xl',
  [MaxWidth.Xl3]: 'max-w-3xl',
  [MaxWidth.Xl4]: 'max-w-4xl',
}

export const SocialConnectFlowContainer = memo(function SocialConnectFlowContainer({
  variant = ContainerVariant.Info,
  icon: Icon,
  platformName,
  showHeader = true,
  maxWidth = MaxWidth.Xl2,
  children
}: SocialConnectFlowContainerProps) {
  const styles = variantStyles[variant]

  return (
    <div className={clsx(maxWidthClasses[maxWidth], 'mx-auto my-2')}>
      <div className={clsx('rounded-md border p-2', styles.border, styles.bg)}>
        {showHeader && platformName && Icon && (
          <div className="mb-1.5">
            <IconWithName Icon={Icon} name={`Link your ${platformName}`} />
          </div>
        )}
        {children}
      </div>
    </div>
  )
})
