import { memo } from 'react'
import Box from '@ux/box'

import type { DetailedPlatformStatus } from '@/lib/social-platforms'
import { PlatformItem } from './PlatformItem'

interface PlatformConnectionsListProps {
  platformStatuses: DetailedPlatformStatus[]
  unlinkingConnectionId: string | null
  onConnectPlatform: (platform: string) => void
  onSelectConnection: (platform: string) => void
  onUnlinkConnection: (socialId: string) => void
}

export const PlatformConnectionsList = memo(function PlatformConnectionsList({
  platformStatuses,
  unlinkingConnectionId,
  onConnectPlatform,
  onSelectConnection,
  onUnlinkConnection
}: PlatformConnectionsListProps) {
  return (
    <Box orientation="vertical" gap="md">
      {platformStatuses.map(({ platform, name, Icon, connections, hiddenCount, overallStatus }) => (
        <PlatformItem
          key={platform}
          platform={platform}
          name={name}
          Icon={Icon}
          connections={connections}
          hiddenCount={hiddenCount}
          overallStatus={overallStatus}
          unlinkingConnectionId={unlinkingConnectionId}
          onConnectPlatform={onConnectPlatform}
          onSelectConnection={onSelectConnection}
          onUnlinkConnection={onUnlinkConnection}
        />
      ))}
    </Box>
  )
})
