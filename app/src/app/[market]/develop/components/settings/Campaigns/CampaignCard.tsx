'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import Card from '@ux/card'
import Collapsible from '@ux/collapsible'
import EmailIcon from '@ux/icon/email'
import FacebookIcon from '@ux/icon/facebook'
import InlineEditIcon from '@ux/icon/inline-edit'
import InstagramIcon from '@ux/icon/instagram'
import MegaphoneIcon from '@ux/icon/megaphone'
import WebsiteIcon from '@ux/icon/website'
import text from '@ux/text'

import { type TopLeadSourceShare, topLeadSourceShare } from '@/app/[market]/develop/components/settings/Campaigns/campaign-stats'
import CampaignStatusBadge from '@/app/[market]/develop/components/settings/Campaigns/CampaignStatusBadge'
import {
  CAMPAIGN_KEYS,
  formatLeadMedium,
  formatLeadSource,
  translateCampaignKey,
} from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { formatCampaignScheduleRange } from '@/app/[market]/develop/components/settings/Campaigns/dates'
import type { Campaign, CampaignLeadsRow, CampaignStats, CampaignStatus } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useTranslations } from '@/hooks/useTranslations'

interface CampaignCardProps {
  campaign: Campaign
  onDetails: () => void
  className?: string
  showLabels?: boolean
  stats?: CampaignStats | null
  statsLoading?: boolean
  statsError?: boolean
}

/** Statuses where a campaign has launched and can have leads attributed to it. */
const LEAD_BEARING_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>([
  'launched',
  'active',
  'completed',
])

/** Map a leads breakdown `source` enum to its channel icon (matches the campaign design). */
function LeadSourceIcon({ source }: { source: string }) {
  const iconClass = 'size-2 shrink-0'
  const normalized: string = source.toUpperCase()
  if (normalized.includes('INSTAGRAM')) return <InstagramIcon className={iconClass} />
  if (normalized.includes('FACEBOOK')) return <FacebookIcon className={iconClass} />
  if (normalized.includes('EMAIL')) return <EmailIcon className={iconClass} />
  if (normalized.includes('BLOG')) return <InlineEditIcon className={iconClass} />
  if (normalized.includes('WEB') || normalized.includes('LANDING') || normalized.includes('DIRECT')) {
    return <WebsiteIcon className={iconClass} />
  }
  return <MegaphoneIcon className={iconClass} />
}

export default function CampaignCard({
  campaign,
  onDetails,
  className,
  showLabels = false,
  stats = null,
  statsLoading = false,
  statsError = false,
}: CampaignCardProps) {
  const t = useTranslations()
  const intl = useIntl()
  const [progressExpanded, setProgressExpanded] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [leadsExpanded, setLeadsExpanded] = useState(false)
  const assetCount = campaign.assets?.length || 0
  const scheduleText = formatCampaignScheduleRange(intl, t, campaign.startDate, campaign.endDate)
  const showProgress = campaign.status === 'active' && (campaign.assets?.length ?? 0) > 0
  const showLeadSections = !!campaign.campaignRefId && LEAD_BEARING_STATUSES.has(campaign.status)
  const leadsInsight: TopLeadSourceShare | null = stats ? topLeadSourceShare(stats) : null
  const statsMessage: string | null = statsLoading
    ? translateCampaignKey(t, CAMPAIGN_KEYS.statsLoading)
    : statsError
      ? translateCampaignKey(t, CAMPAIGN_KEYS.statsError)
      : null

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
            onClick={onDetails}
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

        {showLeadSections && (
          <Box gap="sm">
            <Collapsible
              id={`${campaign.id}-summary`}
              title={<text.span as="caption" className="underline">{translateCampaignKey(t, CAMPAIGN_KEYS.summary)}</text.span>}
              open={summaryExpanded}
              onChange={setSummaryExpanded}
              size="sm"
            >
              {statsMessage ? (
                <text.span as="caption" emphasis="passive">{statsMessage}</text.span>
              ) : stats ? (
                <Box orientation="horizontal">
                  <Card space={{ block: 'md', inline: 'md' }} className="min-w-[220px]">
                    <Box gap="sm">
                      <text.span as="title" size={1}>{intl.formatNumber(stats.totalLeads)}</text.span>
                      <text.span as="caption" emphasis="passive">
                        {translateCampaignKey(t, CAMPAIGN_KEYS.totalLeads)}
                      </text.span>
                    </Box>
                  </Card>
                </Box>
              ) : (
                <text.span as="caption" emphasis="passive">
                  {translateCampaignKey(t, CAMPAIGN_KEYS.leadsEmpty)}
                </text.span>
              )}
            </Collapsible>
            <Collapsible
              id={`${campaign.id}-leads`}
              title={<text.span as="caption" className="underline">{translateCampaignKey(t, CAMPAIGN_KEYS.leadsGenerated)}</text.span>}
              open={leadsExpanded}
              onChange={setLeadsExpanded}
              size="sm"
            >
              {statsMessage ? (
                <text.span as="caption" emphasis="passive">{statsMessage}</text.span>
              ) : stats && stats.breakdown.length > 0 ? (
                <Box gap="sm">
                  {leadsInsight && (
                    <text.span as="caption">
                      {intl.formatMessage(
                        { id: CAMPAIGN_KEYS.leadsInsight, defaultMessage: '{source} drove {percent}% of your visitors' },
                        {
                          source: formatLeadSource(leadsInsight.source),
                          percent: (
                            <text.strong as="caption" emphasis="premium">
                              {leadsInsight.percent}
                            </text.strong>
                          ),
                        },
                      )}
                    </text.span>
                  )}
                  {stats.breakdown.map((row: CampaignLeadsRow, index: number) => (
                    <Box
                      key={`${row.source}-${row.medium}`}
                      orientation="horizontal"
                      blockAlignChildren="spaceBetween"
                      inlineAlignChildren="center"
                      gap="md"
                      className={index > 0 ? 'border-t border-intents-ux-box-borderColor pt-2' : undefined}
                    >
                      <Box orientation="horizontal" inlineAlignChildren="center" gap="sm" className="flex-1 min-w-0">
                        <LeadSourceIcon source={row.source} />
                        <Box className="min-w-0">
                          <text.span as="caption">{formatLeadSource(row.source)}</text.span>
                          {row.medium && (
                            <text.span as="caption" emphasis="passive">{formatLeadMedium(row.medium)}</text.span>
                          )}
                        </Box>
                      </Box>
                      <text.span as="caption" className="shrink-0">
                        {intl.formatMessage(
                          { id: CAMPAIGN_KEYS.leadsCount, defaultMessage: '{count} visitors' },
                          {
                            count: <text.strong as="caption">{intl.formatNumber(row.leads)}</text.strong>,
                          },
                        )}
                      </text.span>
                    </Box>
                  ))}
                </Box>
              ) : (
                <text.span as="caption" emphasis="passive">
                  {translateCampaignKey(t, CAMPAIGN_KEYS.leadsEmpty)}
                </text.span>
              )}
            </Collapsible>
          </Box>
        )}
      </Box>
    </Card>
  )
}
