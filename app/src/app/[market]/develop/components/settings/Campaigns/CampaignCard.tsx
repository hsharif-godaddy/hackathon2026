'use client'

import { useIntl } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import CampaignStatusBadge from '@/app/[market]/develop/components/settings/Campaigns/CampaignStatusBadge'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { formatCampaignDate } from '@/app/[market]/develop/components/settings/Campaigns/dates'
import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useTranslations } from '@/hooks/useTranslations'

interface CampaignCardProps {
  campaign: Campaign
  onDetails: () => void
  className?: string
}

export default function CampaignCard({ campaign, onDetails, className }: CampaignCardProps) {
  const t = useTranslations()
  const intl = useIntl()
  const assetCount = campaign.assets?.length || 0

  return (
    <div className={`border border-intents-ux-border-default rounded-lg p-3${className ? ` ${className}` : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <CampaignStatusBadge status={campaign.status} />
        <Button design="secondary" size="small" onClick={onDetails} text={translateCampaignKey(t, CAMPAIGN_KEYS.seeDetails)} />
      </div>
      <div className="flex flex-col gap-1">
        <text.span as="title" size={0}>{campaign.name}</text.span>
        <text.span as="caption">
          {campaign.offer}
        </text.span>
        <text.span as="caption">
          {formatCampaignDate(intl, campaign.startDate)} — {formatCampaignDate(intl, campaign.endDate)}
          {assetCount > 0 && ` · ${translateCampaignKey(t, CAMPAIGN_KEYS.contentPieces, { count: assetCount })}`}
        </text.span>
      </div>
    </div>
  )
}
