import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Card from '@ux/card'
import text from '@ux/text'

import { IconWithName } from '@/app/develop/components/social/shared/IconWithName'
import { SocialConnectionInfo } from '@/app/develop/components/social/shared/SocialConnectionInfo'
import { useTranslations } from '@/hooks/useTranslations'
import { getSocialConnectionDisplayInfo } from '@/lib/social-utils'
import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { generateClickEID } from '@/utils/instrumentation'
import { Status, StatusBadge } from './StatusBadge'

interface PlatformItemProps {
  platform: string
  name: string
  Icon: React.ComponentType<{ className?: string }>
  connections: Array<(SocialConnection | EnrichedSocialConnection) & { isLinked: boolean }>
  hiddenCount: number
  overallStatus: Status
  unlinkingConnectionId: string | null
  onConnectPlatform: (platform: string) => void
  onSelectConnection: (platform: string) => void
  onUnlinkConnection: (socialId: string) => void
}

export const PlatformItem = memo(function PlatformItem({
  platform,
  name,
  Icon,
  connections,
  hiddenCount,
  overallStatus,
  unlinkingConnectionId,
  onConnectPlatform,
  onSelectConnection,
  onUnlinkConnection
}: PlatformItemProps) {
  const t = useTranslations()
  const hasConnections = connections.length > 0

  return (
    <Card space={{ gap: 'sm', block: 'md' }}>
      <Box orientation="vertical" gap="md">
        {/* Platform header with status */}
        <Box
          orientation="horizontal"
          gap="sm"
          blockAlignChildren="spaceBetween"
          inlineAlignChildren="center"
        >
          <IconWithName Icon={Icon} name={name} />
          <StatusBadge status={overallStatus} />
        </Box>

        {/* Connection details */}
        {hasConnections && (
          <>
            {connections.map((connection) => {
              const displayInfo = getSocialConnectionDisplayInfo(connection)
              const isUnlinking = unlinkingConnectionId === connection.socialId

              return (
                <Box
                  key={connection.socialId}
                  orientation="horizontal"
                  gap="sm"
                  className="ml-5"
                  inlineAlignChildren="center"
                  blockAlignChildren="spaceBetween"
                >
                  <SocialConnectionInfo
                    name={displayInfo.name}
                    pictureUrl={displayInfo.pictureUrl}
                    details={displayInfo.subtitle}
                    className="flex-1 min-w-0"
                  />
                  {connection.isLinked && (
                    <Button
                      size="sm"
                      design="control"
                      onClick={() => onUnlinkConnection(connection.socialId)}
                      disabled={isUnlinking}
                      text={isUnlinking ? t('builder_social_unlinking') : t('builder_social_unlink') }
                      data-eid={generateClickEID('social.settings.unlink')}
                    />
                  )}
                </Box>
              )
            })}
            {hiddenCount > 0 && (
              <Box className="ml-5">
                <text.span as="paragraph" size={-2} text={t('builder_social_more_connections', { count: hiddenCount })} className="opacity-60" />
              </Box>
            )}
          </>
        )}

        {/* CTA at bottom right */}
        {overallStatus !== Status.Linked && (
          <Box orientation="horizontal" gap="sm" blockAlignChildren="end">
            {overallStatus === Status.NotConnected && (
              <Button size="sm" design="primary" onClick={() => onConnectPlatform(platform)} data-eid={generateClickEID('social.settings.connect')}>
                {t('builder_social_connect')}
              </Button>
            )}
            {overallStatus === Status.NotLinked && (
              <Button size="sm" design="primary" onClick={() => onSelectConnection(platform)} data-eid={generateClickEID('social.settings.link_account')}>
                {t('builder_social_link_account')}
              </Button>
            )}
          </Box>
        )}
      </Box>
    </Card>
  )
})
