'use client'

import type { FacebookPage, GoogleLocation } from '@/lib/social'
import { PLATFORM_CONFIG } from '@/lib/social-platforms'
import { SocialItemSelector } from '../shared/SocialItemSelector'

interface SocialPageSelectorProps {
  platform: string
  pages: FacebookPage[] | GoogleLocation[]
  onSelect: (pageId: string) => void
  onCancel: () => void
}

function isFacebookPage(page: FacebookPage | GoogleLocation): page is FacebookPage {
  return 'category' in page
}

function isGoogleLocation(page: FacebookPage | GoogleLocation): page is GoogleLocation {
  return 'storefrontAddress' in page
}

function formatAddress(address?: GoogleLocation['storefrontAddress']): string {
  if (!address) return ''

  const parts: string[] = []

  if (address.addressLines && address.addressLines.length > 0) {
    parts.push(address.addressLines[0])
  }

  if (address.locality) {
    parts.push(address.locality)
  }

  if (address.administrativeArea) {
    parts.push(address.administrativeArea)
  }

  if (address.postalCode) {
    parts.push(address.postalCode)
  }

  return parts.join(', ')
}

export function SocialPageSelector({
  platform,
  pages,
  onSelect,
  onCancel
}: SocialPageSelectorProps) {
  const platformDisplayName = PLATFORM_CONFIG[platform]?.name ?? platform

  const items = pages.map(page => {
    const isFacebook = isFacebookPage(page)
    const isGoogle = isGoogleLocation(page)
    const pageName = isFacebook ? page.name : isGoogle ? page.title : ''
    const subtitle = isFacebook ? page.category : isGoogle ? formatAddress(page.storefrontAddress) : ''

    return {
      id: page.id,
      name: pageName,
      subtitle: subtitle || undefined
    }
  })

  return (
    <SocialItemSelector
      title={`Select a ${platformDisplayName} page to connect`}
      items={items}
      emptyMessage={`No ${platformDisplayName} pages found. Make sure you have pages you manage.`}
      buttons={[
        {
          text: 'Connect Selected Page',
          design: 'primary',
          onClick: (selectedId) => selectedId && onSelect(selectedId),
          requiresSelection: true
        },
        {
          text: 'Cancel',
          design: 'secondary',
          onClick: onCancel
        }
      ]}
    />
  )
}
