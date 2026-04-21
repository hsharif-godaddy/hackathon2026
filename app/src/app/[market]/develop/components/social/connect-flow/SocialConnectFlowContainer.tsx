'use client'

import clsx from 'clsx'
import { memo, ReactNode } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { SocialSectionHeader } from '../shared/SocialSectionHeader'

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
  icon?: React.ComponentType<{ className?: string }> | null
  platformName?: string
  showHeader?: boolean
  maxWidth?: MaxWidth
  children: ReactNode
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
  icon: Icon,
  platformName,
  showHeader = true,
  maxWidth = MaxWidth.Xl2,
  children
}: SocialConnectFlowContainerProps) {
  const t = useTranslations()

  return (
    <div className={clsx(maxWidthClasses[maxWidth], 'mx-auto')}>
      {showHeader && (
        <SocialSectionHeader
          Icon={Icon}
          title={platformName ? t('builder_social_connect_link_platform', { platformName }) : undefined}
        />
      )}
      {children}
    </div>
  )
})
