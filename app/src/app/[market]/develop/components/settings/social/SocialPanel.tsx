'use client'

import { useEffect } from 'react'
import Box from '@ux/box'
import ShareIcon from '@ux/icon/forward'

import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { SocialConnectModal } from '@/app/[market]/develop/components/social/connect-flow/SocialConnectModal'
import SocialFlowsConnectWidget from '@/app/[market]/develop/components/social/connect-flow/SocialFlowsConnectWidget'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useSocialPanelActions } from '@/hooks/social/panel/useSocialPanelActions'
import { useSocialPanelData } from '@/hooks/social/panel/useSocialPanelData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
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

  useEffect(
    function logSocialPanelLoadFailure() {
      if (!data.error) {
        return
      }

      logger.warn('settings.social-panel.load.failed', { siteId, error: data.error })
    },
    [data.error, siteId],
  )

  if (data.isLoading) {
    return <SocialPanelLoadingSkeleton />
  }

  if (data.error) {
    return (
      <EmptyStateCard
        icon={<ShareIcon width={48} height={48} />}
        title={t('builder_settings_socialpanel_empty_title')}
        description={t(
          'builder_settings_socialpanel_load_error_description',
          undefined,
          'Try loading this section again.',
        )}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={actions.refreshConnections}
      />
    )
  }

  return (
    <>
      <SettingsSection
        title={t('builder_settings_socialpanel_title')}
        description={t('builder_settings_socialpanel_desc')}
        isCollapsible
      >
        <PlatformConnectionsList
          platformStatuses={data.platformStatuses}
          unlinkingConnectionId={actions.unlinkingConnectionId}
          onConnectPlatform={actions.handleConnectPlatform}
          onSelectConnection={actions.handleSelectConnection}
          onUnlinkConnection={actions.handleUnlinkConnection}
        />
      </SettingsSection>

      <SocialConnectModal
        platform={actions.selectedPlatform}
        appId={siteId}
        isOpen={actions.isModalOpen}
        onClose={actions.handleModalClose}
        onSuccess={actions.handleModalSuccess}
        selectedConnectionId={actions.selectedConnectionId}
        oauthState={actions.oauthState}
        onOpenSocialFlowsConnect={actions.openSocialFlowsFromModal}
      />

      {actions.isSocialFlowsWidgetOpen && actions.selectedPlatform && (
        <SocialFlowsConnectWidget
          appId={siteId}
          platform={PLATFORM_TRANSFORMS.toDisplay(actions.selectedPlatform)}
          onSuccess={actions.handleModalSuccess}
          onClose={actions.handleFlowsClose}
        />
      )}
    </>
  )
}

export default function SocialPanel({ siteId }: SocialPanelProps) {
  const isVideoGenerationEnabled = useSwitchboard('appbuilder-social-video-generation')

  return (
    <Box gap='lg' className='@container'>
      <SocialPlatformsSection siteId={siteId} />
      {isVideoGenerationEnabled === true && (
        <VideoGenerationSection siteId={siteId} />
      )}
    </Box>
  )
}
