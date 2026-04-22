'use client'

import { memo } from 'react'
import Box from '@ux/box'
import AlertIcon from '@ux/icon/alert'
import FacebookIcon from '@ux/icon/facebook'
import InstagramIcon from '@ux/icon/instagram'
import text from '@ux/text'
import ToggleButton from '@ux/toggle-button'

import { useTranslations } from '@/hooks/useTranslations'
import { type PublishablePlatform } from '@/lib/social-platforms'
import type { SiteAssociation } from '@/types/social'

export interface PlatformValidation {
  valid: boolean
  charCount: number
  maxChars: number
  errors: string[]
}

function hasAssociation(associations: SiteAssociation[], platform: string): boolean {
  return associations.some(a => a.platform.toLowerCase() === platform.toLowerCase())
}

interface PlatformSelectorProps {
  selectedPlatforms: Set<PublishablePlatform>
  onPlatformToggle: (platform: PublishablePlatform) => void
  validation: Record<PublishablePlatform, PlatformValidation>
  associations?: SiteAssociation[]
  isAssociationsUnavailable?: boolean
}

export const PlatformSelector = memo(({
  selectedPlatforms,
  onPlatformToggle,
  validation,
  associations,
  isAssociationsUnavailable
}: PlatformSelectorProps) => {
  const t = useTranslations()

  const platforms: Array<{
    key: PublishablePlatform
    icon: typeof FacebookIcon
    label: string
  }> = [
      { key: 'facebook', icon: FacebookIcon, label: t('builder_social_platform_facebook') },
      { key: 'instagram', icon: InstagramIcon, label: t('builder_social_platform_instagram') },
    ]

  return (
    <Box orientation="vertical">
      {platforms.map(({ key, icon: Icon, label }, index) => {
        const isSelected = selectedPlatforms.has(key)
        const platformValidation = validation[key]
        const isValid = platformValidation?.valid ?? true
        const isConnected = !associations || hasAssociation(associations, key)

        return (
          <div key={key}>
            {index > 0 && <div className="border-t border-intents-ux-border-borderColor" />}
            <div className="py-2">
              <Box orientation="horizontal" blockAlignChildren="center" className="mb-0.5">
                <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className="flex-1">
                  <Icon className="w-2 h-2" />
                  <text.span size={-1}>{label}</text.span>
                </Box>
                <ToggleButton
                  id={`platform-${key}`}
                  active={isSelected}
                  onClick={() => onPlatformToggle(key)}
                />
              </Box>

              {isSelected && !isAssociationsUnavailable && (
                <Box orientation="vertical" gap="sm" className="ml-3">
                  {!isConnected ? (
                    <text.span size={-2} emphasis="passive">
                      {t('builder_social_status_not_connected')}
                    </text.span>
                  ) : (
                    <text.span size={-2} emphasis={isValid ? 'success' : 'warning'}>
                      {isValid ? t('builder_social_platform_ready') : `${platformValidation.charCount} / ${platformValidation.maxChars}`}
                    </text.span>
                  )}
                  {isConnected && !isValid && platformValidation?.errors?.map((error, idx) => (
                    <text.span
                      key={idx}
                      size={-2}
                      emphasis="critical"
                      className="flex items-center gap-0.5"
                    >
                      <AlertIcon className="w-1.5 h-1.5" />
                      {error}
                    </text.span>
                  ))}
                </Box>
              )}
            </div>
          </div>
        )
      })}
    </Box>
  )
})

PlatformSelector.displayName = 'PlatformSelector'
