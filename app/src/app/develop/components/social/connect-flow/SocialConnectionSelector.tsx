'use client'

import { memo, useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { getConnectionDetails, getConnectionDisplayName } from '@/lib/social-utils'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { SocialItemSelector } from '../shared/SocialItemSelector'

interface SocialConnectionSelectorProps {
  platform: string
  platformName: string
  Icon: React.ComponentType<{ className?: string }> | null
  connections: Array<SocialConnection | EnrichedSocialConnection>
  isLoadingMetadata?: boolean
  connectionsLoadingMetadata?: Set<string>
  onSelectExisting: (socialId: string) => Promise<void>
  onConnectNew: () => void
}

export const SocialConnectionSelector = memo(function SocialConnectionSelector({
  platformName,
  Icon,
  connections,
  connectionsLoadingMetadata = new Set(),
  onSelectExisting,
  onConnectNew,
}: SocialConnectionSelectorProps) {
  const t = useTranslations()
  const isSingleConnection = connections.length === 1
  const [isLoading, setIsLoading] = useState(false)

  const handleUseExisting = async (selectedId: string | null) => {
    if (!selectedId) return

    setIsLoading(true)
    try {
      await onSelectExisting(selectedId)
    } finally {
      setIsLoading(false)
    }
  }

  const items = connections.map((connection) => {
    const enriched = connection as any
    return {
      id: connection.socialId,
      name: getConnectionDisplayName(connection) || '',
      subtitle: getConnectionDetails(connection),
      pictureUrl: enriched.pictureUrl,
      isLoading: connectionsLoadingMetadata.has(connection.socialId)
    }
  })

  return (
    <SocialItemSelector
      title={t('builder_social_choose_platform_connection', { platformName })}
      description={t('builder_social_existing_connections_desc')}
      Icon={Icon}
      items={items}
      defaultSelectedId={isSingleConnection ? connections[0].socialId : null}
      buttons={[
        {
          text: t('builder_social_new_connection'),
          design: 'secondary',
          onClick: onConnectNew,
          disabled: () => connectionsLoadingMetadata.size > 0,
          size: 'small',
          eid: 'social.connect.connect_new'
        },
        {
          text: isLoading ? t('builder_social_linking') : t('builder_social_link'),
          design: 'primary',
          onClick: handleUseExisting,
          requiresSelection: true,
          disabled: () => isLoading || connectionsLoadingMetadata.size > 0,
          size: 'small',
          eid: 'social.connect.link_existing'
        }
      ]}
    />
  )
})
