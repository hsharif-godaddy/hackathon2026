'use client'

import ShareIcon from '@ux/icon/forward'

import { SocialConnectModal } from '@/app/develop/components/social/connect-flow/SocialConnectModal'
import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useSocialPanelActions } from '@/hooks/social/panel/useSocialPanelActions'
import { useSocialPanelData } from '@/hooks/social/panel/useSocialPanelData'
import { PlatformConnectionsList } from './PlatformConnectionsList'
import { SocialPanelLoadingSkeleton } from './SocialPanelLoadingSkeleton'

interface SocialPanelProps {
  siteId: string
}

export default function SocialPanel({ siteId }: SocialPanelProps) {
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
        title="Error Loading Connections"
        description={data.error}
        ctaLabel="Retry"
        onCtaClick={actions.refreshConnections}
      />
    )
  }

  return (
    <>
      <BigCard
        title="Social Platforms"
        description="Manage your social media platform connections. Connect or disconnect platforms to control which accounts your app can interact with."
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
