'use client'

import { useIntl } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import Tag from '@ux/tag'
import text from '@ux/text'

import CampaignStatusBadge from '@/app/[market]/develop/components/settings/Campaigns/CampaignStatusBadge'
import {
  assetTypeLabel,
  CAMPAIGN_KEYS,
  translateCampaignKey,
} from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { formatCampaignDate } from '@/app/[market]/develop/components/settings/Campaigns/dates'
import type { Campaign, CampaignAsset } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useTranslations } from '@/hooks/useTranslations'

interface CampaignDetailModalProps {
  campaign: Campaign
  isOpen: boolean
  onClose: () => void
  onDelete?: () => void
}

const ASSET_TYPE_ICONS: Record<string, string> = {
  blog: '\u{1F4DD}',
  social: '\u{1F4F1}',
  email: '\u{2709}\u{FE0F}',
  ad: '\u{1F4E2}',
  'landing-page': '\u{1F310}',
  banner: '\u{1F3A8}',
}

const STATUS_EMPHASIS: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  draft: 'info',
  scheduled: 'warning',
  published: 'success',
  sent: 'success',
}

export default function CampaignDetailModal({ campaign, isOpen, onClose, onDelete }: CampaignDetailModalProps) {
  const t = useTranslations()
  const intl = useIntl()

  if (!isOpen) return null

  const assets = campaign.assets || []
  const groupedAssets = assets.reduce<Record<string, CampaignAsset[]>>((acc, asset) => {
    const group = acc[asset.assetType] || []
    group.push(asset)
    acc[asset.assetType] = group
    return acc
  }, {})

  return (
    <Modal title={campaign.name} onClose={onClose} centered>
      <Box gap="md">
        <Box orientation="horizontal" gap="sm" blockAlignChildren="center">
          <CampaignStatusBadge status={campaign.status} />
          <text.span as="caption">
            {formatCampaignDate(intl, campaign.startDate)} — {formatCampaignDate(intl, campaign.endDate)}
          </text.span>
        </Box>

        <Box gap="sm" inlinePadding="md" blockPadding="md" className="border-0 intents-ux-boxLowContrast rounded-lg">
          <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.goal)}</text.strong>
          <text.p>{campaign.offer}</text.p>
          {campaign.landingPagePath && (
            <text.span as="caption" emphasis="passive">
              {translateCampaignKey(t, CAMPAIGN_KEYS.landingPage, { path: campaign.landingPagePath })}
            </text.span>
          )}
        </Box>

        {Object.entries(groupedAssets).map(([type, typeAssets]) => (
          <Box key={type} gap="sm">
            <text.strong as="caption">
              {ASSET_TYPE_ICONS[type] || ''} {assetTypeLabel(t, type)} ({typeAssets.length})
            </text.strong>
            <Box gap="sm">
              {typeAssets.map((asset) => (
                <Box
                  key={asset.id}
                  orientation="horizontal"
                  gap="md"
                  blockAlignChildren="center"
                  inlinePadding="md"
                  blockPadding="sm"
                  className="border border-intents-ux-border-default rounded-lg"
                >
                  {asset.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.imageUrl}
                      alt={asset.title}
                      className="w-16 h-12 rounded object-cover flex-shrink-0"
                    />
                  )}
                  <Box className="flex-1 min-w-0">
                    <text.span className="truncate font-medium">{asset.title}</text.span>
                    {asset.contentPreview && (
                      <text.span as="caption" emphasis="passive" className="truncate">
                        {asset.contentPreview}
                      </text.span>
                    )}
                    {asset.scheduledDate && (
                      <text.span as="caption" emphasis="passive">
                        {formatCampaignDate(intl, asset.scheduledDate)}
                      </text.span>
                    )}
                  </Box>
                  <Tag emphasis={STATUS_EMPHASIS[asset.status] || 'info'} size="sm">
                    {asset.status}
                  </Tag>
                </Box>
              ))}
            </Box>
          </Box>
        ))}

        {assets.length === 0 && (
          <Box inlinePadding="md" blockPadding="lg" className="text-center">
            <text.span emphasis="passive">{translateCampaignKey(t, CAMPAIGN_KEYS.noContent)}</text.span>
          </Box>
        )}

        <Box orientation="horizontal" gap="md" inlineAlignChildren="end" className="pt-2 border-t border-intents-ux-border-default">
          {onDelete && (
            <Button
              design="tertiary"
              size="sm"
              text={translateCampaignKey(t, CAMPAIGN_KEYS.delete)}
              onClick={onDelete}
            />
          )}
          <Box className="flex-1" />
          <Button
            design="secondary"
            size="sm"
            text={translateCampaignKey(t, CAMPAIGN_KEYS.close)}
            onClick={onClose}
          />
        </Box>
      </Box>
    </Modal>
  )
}
