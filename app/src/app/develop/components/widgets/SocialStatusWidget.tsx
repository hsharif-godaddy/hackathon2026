'use client'

import clsx from 'clsx'
import type { ComponentType } from 'react'
import { memo,useMemo } from 'react'
import text from '@ux/text'

import { useSocialConnections } from '@/hooks/useSocialConnections'
import { useTranslations } from '@/hooks/useTranslations'
import { PLATFORM_CONFIG } from '@/lib/social-platforms'

interface PlatformStatusItemProps {
  name: string
  connected: boolean
  Icon?: ComponentType<{ className?: string }>
}

const PlatformStatusItem = memo(function PlatformStatusItem({ name, connected, Icon }: PlatformStatusItemProps) {
  return (
    <div
      className={clsx(
        'flex items-center gap-0.5 p-1 rounded-sm border',
        connected
          ? 'border-intents-ux-feedbackHighContrastSuccess-feedbackColor'
          : 'bg-muted border-border'
      )}
    >
      {Icon ? (
        <Icon className={clsx('w-3 h-3 flex-shrink-0', !connected && 'opacity-40')} />
      ) : (
        <div className="w-3 h-3 flex-shrink-0 rounded-full bg-muted-foreground/20" />
      )}
      <text.span size={-2} className={clsx('truncate flex-1', !connected && 'opacity-40')} text={name} />
    </div>
  )
})

interface SocialStatusWidgetProps {
  className?: string
}

function SocialStatusWidget({
  className = ''
}: SocialStatusWidgetProps) {
  const t = useTranslations();

  const { data: connectionsData, isLoading, error } = useSocialConnections()

  const connections = useMemo(() => connectionsData ?? [], [connectionsData]);

  const platformStatuses = useMemo(() => {
    const validConnections = connections.filter(c => c.platform);

    return Object.entries(PLATFORM_CONFIG).map(([key, config]) => ({
      platform: key,
      ...config,
      connected: validConnections.some(c =>
        c.platform?.toLowerCase() === key.toLowerCase()
      ),
    }));
  }, [connections]);

  if (isLoading) {
    return (
      <div className={clsx('flex flex-col gap-1 p-1 border border-border rounded-sm my-1', className)}>
        <text.p size={-2} text={t('builder_widgets_socialstatus_loading')} />
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('flex flex-col gap-1 p-1 border border-border rounded-sm my-1', className)}>
        <text.p size={-2} className="text-intents-ux-error-textColor" text={`${t('builder_status_error')}: ${error.message}`} />
      </div>
    )
  }

  return (
    <div className={clsx('flex flex-col gap-1 p-1 border border-border rounded-sm my-1', className)}>
      <div className="grid grid-cols-2 gap-1.5">
        {platformStatuses.map(({ platform, name, Icon, connected }) => (
          <PlatformStatusItem
            key={platform}
            name={name}
            connected={connected}
            Icon={Icon}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(SocialStatusWidget)
