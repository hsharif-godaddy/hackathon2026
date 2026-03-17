'use client'

import { useTranslations } from '@/hooks/useTranslations'
import type { FacebookPage, GoogleLocation } from '@/lib/social'
import { PLATFORM_CONFIG } from '@/lib/social-platforms'
import { getSocialConnectionDisplayInfo } from '@/lib/social-utils'
import { SocialItemSelector } from '../shared/SocialItemSelector'

interface SocialPageSelectorProps {
  platform: string
  pages: FacebookPage[] | GoogleLocation[]
  onSelect: (pageId: string) => void
  onCancel: () => void
}

export function SocialPageSelector({
  platform,
  pages,
  onSelect,
  onCancel
}: SocialPageSelectorProps) {
  const t = useTranslations()
  const platformDisplayName = PLATFORM_CONFIG[platform]?.name ?? platform
  const isInstagramFlow = platform === 'instagram'

  const items = pages.map(page => {
    const displayInfo = getSocialConnectionDisplayInfo(page, { isInstagramFlow })
    return {
      id: page.id,
      ...displayInfo
    }
  })

  return (
    <SocialItemSelector
      title={t('builder_social_select_platform_page', { platformDisplayName })}
      items={items}
      emptyMessage={t('builder_social_no_pages_found', { platformDisplayName })}
      buttons={[
        {
          text: t('builder_common_cancel'),
          design: 'secondary',
          onClick: onCancel,
          eid: 'social.page.cancel'
        },
        {
          text: t('builder_social_connect_selected_page'),
          design: 'primary',
          onClick: (selectedId) => selectedId && onSelect(selectedId),
          requiresSelection: true,
          eid: 'social.page.select'
        }
      ]}
    />
  )
}
