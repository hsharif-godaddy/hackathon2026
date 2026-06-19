'use client'

import ImageIcon from '@ux/icon/image'

import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useTranslations } from '@/hooks/useTranslations'

interface MediaLoadErrorProps {
  onRetry: () => void
}

export function MediaLoadError({ onRetry }: MediaLoadErrorProps) {
  const t = useTranslations()

  return (
    <EmptyStateCard
      icon={<ImageIcon width={48} height={48} />}
      title={t('builder_mediaslot_error_fail_title')}
      description={t('builder_mediaslot_error_fail_description', undefined, 'Try again in a minute.')}
      ctaLabel={t('builder_common_retry')}
      onCtaClick={onRetry}
    />
  )
}
