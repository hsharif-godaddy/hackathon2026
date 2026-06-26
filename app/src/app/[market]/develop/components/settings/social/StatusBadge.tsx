import { type ComponentProps, memo } from 'react'
import Tag from '@ux/tag'

import { useTranslations } from '@/hooks/useTranslations'

type Emphasis = ComponentProps<typeof Tag>['emphasis']

export enum Status {
  Linked = 'linked',
  NotLinked = 'notLinked',
  NotConnected = 'notConnected'
}

const getStatusConfig = (t: ReturnType<typeof useTranslations>): Record<Status, { text: string; emphasis: Emphasis }> => ({
  [Status.Linked]: { text: t('builder_social_status_linked'), emphasis: 'success' as const },
  [Status.NotLinked]: { text: t('builder_social_status_available_to_link'), emphasis: 'warning' as const },
  [Status.NotConnected]: { text: t('builder_social_status_not_connected'), emphasis: 'neutral' as const },
})
interface StatusBadgeProps {
  status: Status
}

export const StatusBadge = memo(function StatusBadge({ status }: StatusBadgeProps) {
  const t = useTranslations()
  const statusConfig = getStatusConfig(t)
  const { text: statusText, emphasis } = statusConfig[status]
  return <Tag emphasis={emphasis} size="sm">{statusText}</Tag>
})
