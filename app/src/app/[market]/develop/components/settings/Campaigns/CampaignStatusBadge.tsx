'use client'

import CalendarIcon from '@ux/icon/calendar'
import CheckmarkIcon from '@ux/icon/checkmark'
import SendIcon from '@ux/icon/send'
import SparklesIcon from '@ux/icon/sparkles'
import Tag from '@ux/tag'

import { statusBadgeLabel } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { CampaignStatus } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useTranslations } from '@/hooks/useTranslations'

type TagEmphasis = NonNullable<React.ComponentProps<typeof Tag>['emphasis']>

const STATUS_CONFIG: Record<CampaignStatus, { emphasis: TagEmphasis; icon?: React.ReactNode }> = {
  draft: { emphasis: 'warning' },
  ready: { emphasis: 'highlight', icon: <SparklesIcon width={12} height={12} /> },
  launched: { emphasis: 'warning', icon: <CalendarIcon width={12} height={12} /> },
  active: { emphasis: 'success', icon: <SendIcon width={12} height={12} /> },
  completed: { emphasis: 'passive', icon: <CheckmarkIcon width={12} height={12} /> },
  archived: { emphasis: 'passive' },
}

export default function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const t = useTranslations()
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft

  return (
    <Tag
      emphasis={cfg.emphasis}
      size="md"
      icon={cfg.icon}
    >
      {statusBadgeLabel(t, status)}
    </Tag>
  )
}
