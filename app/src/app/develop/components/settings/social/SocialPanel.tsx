'use client'

import ShareIcon from '@ux/icon/forward'

import { SocialConnectModal } from '@/app/develop/components/social/connect-flow/SocialConnectModal'
import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useSocialPanelActions } from '@/hooks/social/panel/useSocialPanelActions'
import { useSocialPanelData } from '@/hooks/social/panel/useSocialPanelData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { PlatformConnectionsList } from './PlatformConnectionsList'
import { SocialPanelLoadingSkeleton } from './SocialPanelLoadingSkeleton'
import { VideoGenerationSection } from './VideoGenerationSection'

interface SocialPanelProps {
  siteId: string
}

function SocialPlatformsSection({ siteId }: SocialPanelProps) {
  const t = useTranslations()
  const data = useSocialPanelData(siteId)
  const actions = useSocialPanelActions({ siteId, siteLinks: data.siteLinks })

  if (data.isLoading) {
    return <SocialPanelLoadingSkeleton />
  }

  if (data.error) {
    return (
      <EmptyStateCard
        icon={<ShareIcon width={48} height={48} />}
        title={t('builder_settings_socialpanel_empty_title')}
        description={data.error}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={actions.refreshConnections}
      />
    )
  }

  return (
    <>
      <BigCard
        title={t('builder_settings_socialpanel_title')}
        description={t('builder_settings_socialpanel_desc')}
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
        oauthState={actions.oauthState}
      />
    </>
  )
}

export default function SocialPanel({ siteId }: SocialPanelProps) {
  const { data: isVideoGenerationEnabled } = useSwitchboard('appbuilder-social-video-generation')

  return (
    <>
      <SocialPlatformsSection siteId={siteId} />
      {isVideoGenerationEnabled === true && (
        <div className="mt-4">
          <VideoGenerationSection siteId={siteId} />
        </div>
      )}
    </>
  )
}
