
'use client'

import { memo } from 'react'
import Tabs from '@ux/tabs'

import { useTranslations } from '@/hooks/useTranslations'
import { type PublishablePlatform } from '@/lib/social-platforms'
import { SocialPlatform } from '@/types/social'

interface PreviewTabsProps {
  selectedPlatform: PublishablePlatform
  onPlatformChange: (platform: PublishablePlatform) => void
  selectedPlatforms: Set<PublishablePlatform>
}

export const PreviewTabs = memo(({
  selectedPlatform,
  onPlatformChange,
  selectedPlatforms
}: PreviewTabsProps) => {
  const t = useTranslations()

  const items = [
    {
      id: SocialPlatform.FACEBOOK,
      text: t('builder_social_platform_facebook'),
      disabled: !selectedPlatforms.has(SocialPlatform.FACEBOOK),
      content: null
    },
    {
      id: SocialPlatform.INSTAGRAM,
      text: t('builder_social_platform_instagram'),
      disabled: !selectedPlatforms.has(SocialPlatform.INSTAGRAM),
      content: null
    }
  ]

  return (
    <Tabs
      id="preview-tabs"
      design="manila"
      portalElem={document.body}
      selected={selectedPlatform}
      onChange={onPlatformChange}
      items={items}
      className="mb-2"
    />
  )
})

PreviewTabs.displayName = 'PreviewTabs'
