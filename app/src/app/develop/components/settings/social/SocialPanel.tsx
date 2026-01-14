'use client'

import ShareIcon from '@ux/icon/forward'

import { SocialConnectModal } from '@/app/develop/components/social/connect-flow/SocialConnectModal'
import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useSocialPanelActions } from '@/hooks/social/panel/useSocialPanelActions'
import { useSocialPanelData } from '@/hooks/social/panel/useSocialPanelData'
import { useTranslations } from '@/hooks/useTranslations'
import { PlatformConnectionsList } from './PlatformConnectionsList'
import { SocialPanelLoadingSkeleton } from './SocialPanelLoadingSkeleton'

interface SocialPanelProps {
  siteId: string
}

export default function SocialPanel({ siteId }: SocialPanelProps) {
  const t = useTranslations()

  // Fetch and compute all data
  const data = useSocialPanelData(siteId)

  // Setup all actions and state management
  const actions = useSocialPanelActions({
    siteId,
    siteLinks: data.siteLinks
  })

  // Loading state
  if (data.isLoading) {
    return <SocialPanelLoadingSkeleton />
  }

  // Error state
  if (data.error) {
    return (
      <EmptyStateCard
        icon={<ShareIcon width={48} height={48} />}
        title={t('builder_social_error_loading_connections')}
        description={data.error}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={actions.refreshConnections}
      />
    )
  }

  return (
    <>
      <BigCard
        title={t('builder_social_platforms_title')}
        description={t('builder_social_platforms_description')}
      >
        <PlatformConnectionsList
          platformStatuses={data.platformStatuses}
          unlinkingConnectionId={actions.unlinkingConnectionId}
          onConnectPlatform={actions.handleConnectPlatform}
          onSelectConnection={actions.handleSelectConnection}
          onUnlinkConnection={actions.handleUnlinkConnection}
        />
      </BigCard>

      <SocialConnectModal
        platform={actions.selectedPlatform}
        appId={siteId}
        isOpen={actions.isModalOpen}
        onClose={actions.handleModalClose}
        onSuccess={actions.handleModalSuccess}
        selectedConnectionId={actions.selectedConnectionId}
      />
    </>
  )
}
