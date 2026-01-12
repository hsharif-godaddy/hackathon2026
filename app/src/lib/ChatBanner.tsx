'use client'

import clsx from 'clsx'
import type { ReactNode } from 'react'
import Button from '@ux/button'
import XIcon from '@ux/icon/x'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'

type BannerVariant = 'warning' | 'info' | 'critical' | 'success'

const variantStyles: Record<BannerVariant, string> = {
  warning: 'bg-intents-ux-feedbackWarning-feedbackColor',
  info: 'bg-intents-ux-feedbackInfo-feedbackColor',
  critical: 'bg-intents-ux-feedbackCritical-feedbackColor',
  success: 'bg-intents-ux-feedbackSuccess-feedbackColor'
}

interface ChatBannerProps {
  children: ReactNode
  variant?: BannerVariant
  onClose?: () => void
  className?: string
}

export default function ChatBanner({
  children,
  variant = 'warning',
  onClose,
  className
}: ChatBannerProps) {
  const t = useTranslations()

  return (
    <div className={clsx(
      'flex justify-between gap-2 px-2 py-1 mx-4 sm:mx-3 md:mx-2 rounded-t-lg',
      variantStyles[variant],
      className
    )}>
      <text.span as="caption" size={-1} className="flex-1">
        {children}
      </text.span>
      {onClose && (
        <Button
          className="flex-shrink-0"
          design="inline"
          size="sm"
          onClick={onClose}
          icon={<XIcon />}
          aria-label={t('builder_common_close')}
        />
      )}
    </div>
  )
}
