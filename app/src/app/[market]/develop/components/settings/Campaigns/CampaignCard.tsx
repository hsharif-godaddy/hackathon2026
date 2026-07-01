'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import Card from '@ux/card'
import Collapsible from '@ux/collapsible'
import text from '@ux/text'

import CampaignStatusBadge from '@/app/[market]/develop/components/settings/Campaigns/CampaignStatusBadge'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { formatCampaignScheduleRange } from '@/app/[market]/develop/components/settings/Campaigns/dates'
import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useImpression } from '@/hooks/useImpression'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

interface CampaignCardProps {
  campaign: Campaign
  onDetails: () => void
  className?: string
  showLabels?: boolean
}

export default function CampaignCard({ campaign, onDetails, className, showLabels = false }: CampaignCardProps) {
  const t = useTranslations()
  const intl = useIntl()
  const [progressExpanded, setProgressExpanded] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [leadsExpanded, setLeadsExpanded] = useState(false)
  const assetCount = campaign.assets?.length || 0
  const scheduleText = formatCampaignScheduleRange(intl, t, campaign.startDate, campaign.endDate)
  const showProgress = campaign.status === 'active' && (campaign.assets?.length ?? 0) > 0
  const showCompletedSections = campaign.status === 'completed'

  useImpression('settings.campaigns.cardView', {
    customProperties: { campaignId: campaign.id, campaignStatus: campaign.status },
  })

  const handleDetails = () => {
    logClickEvent('settings.campaigns.cardDetails', { campaignId: campaign.id })()
    onDetails()
  }

  return (
    <Card
      id={`campaign-card-${campaign.id}`}
      space={{ block: 'md', inline: 'md', gap: 'sm' }}
      className={className}
    >
      <Box gap="sm">
        <Box
          orientation="horizontal"
          blockAlignChildren="spaceBetween"
          inlineAlignChildren="center"
          gap="sm"
        >
          <CampaignStatusBadge status={campaign.status} />
          <Button
            design="secondary"
            size="small"
            onClick={handleDetails}
            text={translateCampaignKey(t, CAMPAIGN_KEYS.seeDetails)}
          />
        </Box>

        <text.span as="title" size={1} className="line-clamp-2">
          {campaign.name}
        </text.span>

        {showLabels ? (
          <Box gap="sm">
            <text.span as="caption" emphasis="passive">
              <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.schedule)}: </text.strong>
              {scheduleText}
            </text.span>
            <text.span as="caption" emphasis="passive">
              <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.goal)}: </text.strong>
              {campaign.offer}
            </text.span>
          </Box>
        ) : (
          <Box gap="sm">
            <text.span as="caption" emphasis="passive">
              {campaign.offer}
            </text.span>
            <text.span as="caption" emphasis="passive">
              {scheduleText}
              {assetCount > 0 && ` · ${translateCampaignKey(t, CAMPAIGN_KEYS.contentPieces, { count: assetCount })}`}
            </text.span>
          </Box>
        )}

        {showProgress && (
          <Collapsible
            id={`${campaign.id}-progress`}
            title={translateCampaignKey(t, CAMPAIGN_KEYS.progress)}
            open={progressExpanded}
            onChange={setProgressExpanded}
            size="sm"
          >
            <Box gap="sm">
              {campaign.assets?.map((asset) => (
                <text.span as="caption" emphasis="passive" key={asset.id}>
                  {asset.title}
                  {' · '}
                  <text.span as="caption">{asset.status}</text.span>
                </text.span>
              ))}
            </Box>
          </Collapsible>
        )}

        {showCompletedSections && (
          <Box gap="sm">
            <Collapsible
              id={`${campaign.id}-summary`}
              title={translateCampaignKey(t, CAMPAIGN_KEYS.summary)}
              open={summaryExpanded}
              onChange={setSummaryExpanded}
              size="sm"
            />
            <Collapsible
              id={`${campaign.id}-leads`}
              title={translateCampaignKey(t, CAMPAIGN_KEYS.leadsGenerated)}
              open={leadsExpanded}
              onChange={setLeadsExpanded}
              size="sm"
            />
          </Box>
        )}
      </Box>
    </Card>
  )
}
