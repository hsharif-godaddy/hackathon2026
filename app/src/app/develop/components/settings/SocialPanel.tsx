'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Card from '@ux/card'
import ShareIcon from '@ux/icon/share'
import Skeleton from '@ux/skeleton'
import text from '@ux/text'

import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useSocialConnections } from '@/hooks/useSocialConnections'
import { useTranslations } from '@/hooks/useTranslations';
import { mapPlatformStatuses, type SocialConnection } from '@/lib/social-platforms'

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
  t: ReturnType<typeof useTranslations>
}

const STATUS_CONFIG = {
  connected: { emphasis: 'success' as const },
  notConnected: { emphasis: 'warning' as const },
}

const StatusBadge = memo(function StatusBadge({ isConnected, t }: StatusBadgeProps) {
  const statusKey = isConnected ? 'connected' : 'notConnected'
  const { emphasis } = STATUS_CONFIG[statusKey]

  return (
    <text.span
      as="label"
      size={-2}
      text={t(`builder_settings_socialpanel_status_${statusKey}`)}
      emphasis={emphasis}
      className="uppercase"
    />
  )
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
  const t = useTranslations();
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
            <StatusBadge
              isConnected={isConnected}
              t={t}
            />
          )}
        </Box>
      </Box>
    </Card>
  )
}

export default function SocialPanel() {
  const t = useTranslations();
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
        title={t('builder_settings_socialpanel_title')}
        description={t('builder_settings_socialpanel_desc')}
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
        title={t('builder_settings_socialpanel_empty_title')}
        description={error instanceof Error ? error.message : t('builder_settings_socialpanel_empty_desc')}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={() => refetch()}
      />
    )
  }

  return (
    <BigCard
      title={t('builder_settings_socialpanel_title')}
      description={t('builder_settings_socialpanel_desc')}
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
