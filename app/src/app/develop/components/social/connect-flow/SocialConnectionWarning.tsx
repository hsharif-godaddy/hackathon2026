'use client'

import { memo } from 'react'
import Button from '@ux/button'
import text from '@ux/text'

import { SocialSectionHeader } from '../shared/SocialSectionHeader'

interface SocialConnectionWarningProps {
  platformName: string
  Icon: React.ComponentType<{ className?: string }> | null
  connectionName?: string
  onChangeConnection: () => void
}

export const SocialConnectionWarning = memo(function SocialConnectionWarning({
  platformName,
  Icon,
  connectionName,
  onChangeConnection,
}: SocialConnectionWarningProps) {
  return (
    <div className="space-y-1.5">
      <SocialSectionHeader Icon={Icon} title={`${platformName} already connected`} />

      <div className="rounded-md bg-intents-ux-warning-backgroundColor border border-intents-ux-warning-borderColor p-1.5">
        <text.p
          size={-2}
          className="text-intents-ux-warning-textColor"
          text={
            connectionName
              ? `This site is already connected to ${connectionName}.`
              : `This site already has a ${platformName} connection.`
          }
        />
      </div>

      <text.p size={-2} className="text-muted-foreground" text="You can change to a different connection." />

      <div className="flex gap-1 pt-1">
        <Button
          design="primary"
          size="sm"
          onClick={onChangeConnection}
          text="Change Connection"
        />
      </div>
    </div>
  )
})
