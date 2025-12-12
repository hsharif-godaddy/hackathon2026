'use client'

import { memo } from 'react'
import { mapPlatformStatuses, type SocialConnection } from '@/lib/social-platforms'
import { useSocialConnections } from '@/hooks/useSocialConnections'
import Skeleton from '@ux/skeleton'
import text from '@ux/text'
import Box from '@ux/box'
import Card from '@ux/card'
import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import ShareIcon from '@ux/icon/share'

interface IconWithNameProps {
  Icon: React.ComponentType<{ className?: string }>
  name: string
}

const IconWithName = memo(function IconWithName({ Icon, name }: IconWithNameProps) {
  return (
    <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
      <Icon className="w-4 h-4 flex-shrink-0" />
      <text.span as="paragraph" size={-1} text={name} className="font-medium" />
    </Box>
  )
})

interface StatusBadgeProps {
  isConnected: boolean
}

const STATUS_CONFIG = {
  connected: { text: 'Connected', emphasis: 'success' as const },
  notConnected: { text: 'Not Connected', emphasis: 'warning' as const },
}

const StatusBadge = memo(function StatusBadge({ isConnected }: StatusBadgeProps) {
  const statusKey = isConnected ? 'connected' : 'notConnected'
  const { text: statusText, emphasis } = STATUS_CONFIG[statusKey]

  return <text.span as="label" size={-2} text={statusText} emphasis={emphasis} className="uppercase" />
})

const LoadingState = memo(function LoadingState() {
  return (
    <>
      <Skeleton size="sm" width="100px" height="32px" />
      <Skeleton size="sm" width="90px" height="32px" />
    </>
  )
})

interface PlatformItemProps {
  name: string
  Icon: React.ComponentType<{ className?: string }>
  connection?: SocialConnection
  isLoading?: boolean
}

function PlatformItem({ name, Icon, connection, isLoading }: PlatformItemProps) {
  const isConnected = !!connection

  return (
    <Card space={{ gap: 'sm', block: 'md' }}>
      <Box
        orientation="horizontal"
        gap="sm"
        blockAlignChildren="spaceBetween"
        inlineAlignChildren="center"
      >
        <IconWithName Icon={Icon} name={name} />

        <Box orientation="horizontal" gap="lg" blockAlignChildren="center" inlineAlignChildren="center" className="flex-shrink-0">
          {isLoading ? (
            <LoadingState />
          ) : (
            <StatusBadge isConnected={isConnected} />
          )}
        </Box>
      </Box>
    </Card>
  )
}

export default function SocialPanel() {
  const {
    data: connections = [],
    isLoading,
    error,
    refetch,
  } = useSocialConnections()

  const platformStatuses = mapPlatformStatuses(connections)

  if (isLoading) {
    const platformStatuses = mapPlatformStatuses([])

    return (
      <BigCard
        title="Social Platforms"
        description="Manage your social media platform connections. Connect or disconnect platforms to control which accounts your app can interact with."
      >
        <Box orientation="vertical" gap="sm">
          {platformStatuses.map(({ platform, name, Icon }) => (
            <Card key={platform} space={{ gap: 'sm', block: 'md' }}>
              <Box
                orientation="horizontal"
                gap="sm"
                blockAlignChildren="spaceBetween"
                inlineAlignChildren="center"
              >
                <IconWithName Icon={Icon} name={name} />
                <Box orientation="horizontal" gap="sm" blockAlignChildren="center" className="flex-shrink-0">
                  <LoadingState />
                </Box>
              </Box>
            </Card>
          ))}
        </Box>
      </BigCard>
    )
  }

  if (error) {
    return (
      <EmptyStateCard
        icon={<ShareIcon width={48} height={48} />}
        title="Error Loading Connections"
        description={error instanceof Error ? error.message : 'Failed to load connections'}
        ctaLabel="Retry"
        onCtaClick={() => refetch()}
      />
    )
  }

  return (
    <BigCard
      title="Social Platforms"
      description="Manage your social media platform connections. Connect or disconnect platforms to control which accounts your app can interact with."
    >
      <Box orientation="vertical" gap="md">
        {platformStatuses.map(({ platform, name, Icon, connection }) => (
          <PlatformItem
            key={platform}
            name={name}
            Icon={Icon}
            connection={connection}
          />
        ))}
      </Box>
    </BigCard>
  )
}
