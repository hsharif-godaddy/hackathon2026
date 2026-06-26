'use client'

import clsx from 'clsx'
import type { ReactElement, ReactNode } from 'react'
import Button from '@ux/button'
import XIcon from '@ux/icon/x'

import { useTranslations } from '@/hooks/useTranslations'

interface PreviewBarProps {
  children: ReactNode
  onClose?: () => void
  closeEid?: string
  className?: string
}

export default function PreviewBar({ children, onClose, closeEid, className }: PreviewBarProps): ReactElement {
  const t = useTranslations()
  return (
    <div
      className={clsx(
        'mx-2 px-2 md:px-3 py-0.5 rounded-t-lg leading-none bg-ai text-intents-ux-boxHighContrast-foregroundColor flex items-center justify-between gap-2',
        className
      )}
    >
      {children}
      {onClose && (
        <Button
          design="inline"
          size="sm"
          onClick={onClose}
          icon={<XIcon className="!size-2" />}
          aria-label={t('builder_preview_bar_dismiss', {}, 'Dismiss preview banner')}
          data-eid={closeEid}
          className="!text-intents-ux-boxHighContrast-foregroundColor shrink-0"
        />
      )}
    </div>
  )
}
