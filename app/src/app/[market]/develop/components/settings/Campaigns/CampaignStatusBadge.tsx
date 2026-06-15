'use client'

import CalendarIcon from '@ux/icon/calendar'
import FlagIcon from '@ux/icon/flag'
import StopIcon from '@ux/icon/stop'

import { statusBadgeLabel } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { CampaignStatus } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useTranslations } from '@/hooks/useTranslations'

const STATUS_TEXT = 'text-intents-ux-foreground-default'

const STATUS_CLASS: Record<CampaignStatus, { className: string; icon?: React.ReactNode }> = {
  draft: {
    className: `bg-intents-ux-feedbackWarning-feedbackColor ${STATUS_TEXT}`,
  },
  ready: {
    className: 'bg-ai text-white',
    icon: '✦',
  },
  launched: {
    className: `bg-intents-ux-feedbackWarning-feedbackColor ${STATUS_TEXT}`,
    icon: <CalendarIcon width={12} height={12} />,
  },
  active: {
    className: `bg-intents-ux-feedbackSuccess-feedbackColor ${STATUS_TEXT}`,
    icon: <FlagIcon width={12} height={12} />,
  },
  completed: {
    className: `bg-intents-ux-feedbackPassive-feedbackColor ${STATUS_TEXT}`,
    icon: <StopIcon width={12} height={12} />,
  },
  archived: {
    className: `bg-intents-ux-feedbackPassive-feedbackColor ${STATUS_TEXT}`,
  },
}

export default function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const t = useTranslations()
  const cfg = STATUS_CLASS[status] ?? STATUS_CLASS.draft

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-xs font-bold ${cfg.className}`}
    >
      {cfg.icon && <span className="flex items-center">{cfg.icon}</span>}
      {statusBadgeLabel(t, status)}
    </span>
  )
}
