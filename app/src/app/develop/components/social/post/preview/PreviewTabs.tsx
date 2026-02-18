/* eslint-disable react/display-name */
'use client'

import { memo } from 'react'
import Tabs from '@ux/tabs'

import { useTranslations } from '@/hooks/useTranslations'
import { type PublishablePlatform } from '@/lib/social-platforms'

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
      id: 'facebook',
      text: t('builder_social_platform_facebook'),
      disabled: !selectedPlatforms.has('facebook'),
      content: null
    },
    {
      id: 'instagram',
      text: t('builder_social_platform_instagram'),
      disabled: !selectedPlatforms.has('instagram'),
      content: null
    }
  ]

  return (
    <Tabs
      id="preview-tabs"
      design="manila"
      selected={selectedPlatform}
      onChange={onPlatformChange}
      items={items}
      className="mb-2"
    />
  )
})

PreviewTabs.displayName = 'PreviewTabs'
