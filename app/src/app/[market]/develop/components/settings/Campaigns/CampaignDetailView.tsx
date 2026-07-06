'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import Card from '@ux/card'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import EmailIcon from '@ux/icon/email'
import FacebookIcon from '@ux/icon/facebook'
import ImageIcon from '@ux/icon/image'
import InlineEditIcon from '@ux/icon/inline-edit'
import InstagramIcon from '@ux/icon/instagram'
import MegaphoneIcon from '@ux/icon/megaphone'
import TrashIcon from '@ux/icon/trash'
import WebsiteIcon from '@ux/icon/website'
import Tag from '@ux/tag'
import text from '@ux/text'

import CampaignStatusBadge from '@/app/[market]/develop/components/settings/Campaigns/CampaignStatusBadge'
import {
  assetStatusLabel,
  assetTypeLabel,
  CAMPAIGN_KEYS,
  translateCampaignKey,
} from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { formatAssetDateTime, formatCampaignScheduleRange } from '@/app/[market]/develop/components/settings/Campaigns/dates'
import type { Campaign, CampaignAsset, CampaignAssetStatus, CampaignAssetType } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useTranslations } from '@/hooks/useTranslations'

interface CampaignDetailViewProps {
  campaign: Campaign
  onBack: () => void
  onDelete?: () => void
  onEditAsset?: (asset: CampaignAsset) => void
}

const STATUS_EMPHASIS: Record<CampaignAssetStatus, 'info' | 'success' | 'warning' | 'neutral' | 'passive'> = {
  draft: 'neutral',
  scheduled: 'warning',
  published: 'success',
  sent: 'success',
}

function AssetTypeIcon({ assetType }: { assetType: CampaignAssetType | string }) {
  const iconClass = 'size-2 inline-block'
  if (assetType === 'social') {
    return (
      <span className="inline-flex items-center gap-0.5">
        <InstagramIcon className={iconClass} />
        <FacebookIcon className={iconClass} />
      </span>
    )
  }
  if (assetType === 'blog') return <InlineEditIcon className={iconClass} />
  if (assetType === 'email') return <EmailIcon className={iconClass} />
  if (assetType === 'ad') return <MegaphoneIcon className={iconClass} />
  if (assetType === 'landing-page') return <WebsiteIcon className={iconClass} />
  if (assetType === 'banner') return <ImageIcon className={iconClass} />
  return null
}

function CampaignAssetRow({ asset, onEditAsset }: { asset: CampaignAsset; onEditAsset?: (asset: CampaignAsset) => void }) {
  const t = useTranslations()
  const intl = useIntl()
  const dateStr = formatAssetDateTime(intl, t, asset.scheduledDate)
  const comingSoon = translateCampaignKey(t, CAMPAIGN_KEYS.comingSoon)
  const canEdit = asset.assetType === 'social' && onEditAsset

  return (
    <Card space={{ block: 'md', inline: 'md' }}>
      <div className="flex items-center gap-3">
        {asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.imageUrl}
            alt={asset.title}
            className="w-[70px] h-[70px] rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-[70px] h-[70px] rounded-lg bg-intents-ux-boxLowContrast-backgroundColor shrink-0 flex items-center justify-center">
            <AssetTypeIcon assetType={asset.assetType} />
          </div>
        )}

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag emphasis={STATUS_EMPHASIS[asset.status] ?? 'neutral'} size="sm">
            {assetStatusLabel(t, asset.status)}
          </Tag>
          {dateStr && (
            <text.span as="caption" emphasis="passive">{dateStr}</text.span>
          )}
          <text.span as="caption" emphasis="passive">·</text.span>
          <div className="flex items-center gap-1">
            <AssetTypeIcon assetType={asset.assetType} />
            <text.span as="caption" emphasis="passive">
              {assetTypeLabel(t, asset.assetType)}
            </text.span>
          </div>
        </div>

        {asset.title && (
          <text.span as="title" size={0}>{asset.title}</text.span>
        )}
        {asset.contentPreview && (
          <text.span as="caption" emphasis="passive" className="line-clamp-2">
            {asset.contentPreview}
          </text.span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          design="tertiary"
          size="small"
          icon={<TrashIcon width={16} height={16} />}
          aria-label={translateCampaignKey(t, CAMPAIGN_KEYS.delete)}
          disabled
          title={comingSoon}
        />
        <Button
          design="secondary"
          size="small"
          icon={<InlineEditIcon width={14} height={14} />}
          text={translateCampaignKey(t, CAMPAIGN_KEYS.editAsset)}
          disabled={!canEdit}
          title={canEdit ? undefined : comingSoon}
          onClick={canEdit ? () => onEditAsset(asset) : undefined}
        />
      </div>
    </div>
    </Card>
  )
}

export default function CampaignDetailView({ campaign, onBack, onDelete, onEditAsset }: CampaignDetailViewProps) {
  const t = useTranslations()
  const intl = useIntl()
  const assets = campaign.assets || []
  const comingSoon = translateCampaignKey(t, CAMPAIGN_KEYS.comingSoon)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <Box gap="lg" className="w-full p-5">
      <Box orientation="horizontal" blockAlignChildren="spaceBetween" inlineAlignChildren="center" gap="md">
        <Box orientation="horizontal" inlineAlignChildren="center" gap="sm" className="flex-1 min-w-0">
          <Button
            design="inline"
            size="small"
            icon={<ChevronLeftIcon className="size-2.5 rtl:scale-x-[-1]" />}
            aria-label={translateCampaignKey(t, CAMPAIGN_KEYS.listBack)}
            onClick={onBack}
          />
          <text.span as="title" size={2} className="truncate">{campaign.name}</text.span>
        </Box>

        <Box orientation="horizontal" gap="sm" className="shrink-0">
          {onDelete && !confirmingDelete && (
            <Button
              design="tertiary"
              size="small"
              icon={<TrashIcon width={16} height={16} />}
              aria-label={translateCampaignKey(t, CAMPAIGN_KEYS.delete)}
              onClick={() => setConfirmingDelete(true)}
            />
          )}
          <Button
            design="primary"
            size="small"
            text={translateCampaignKey(t, CAMPAIGN_KEYS.approveLaunch)}
            disabled
            title={comingSoon}
          />
        </Box>
      </Box>

      {confirmingDelete && (
        <Box orientation="horizontal" inlineAlignChildren="center" gap="sm"
          className="rounded-lg border border-intents-ux-status-critical-borderColor bg-intents-ux-status-critical-backgroundColor px-4 py-3"
        >
          <Box className="flex-1">
            <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.deleteConfirmTitle)}</text.strong>
            <text.span as="caption" emphasis="passive"> {translateCampaignKey(t, CAMPAIGN_KEYS.deleteConfirmDescription)}</text.span>
          </Box>
          <Button
            design="tertiary"
            size="small"
            text={translateCampaignKey(t, CAMPAIGN_KEYS.deleteConfirmCancel)}
            onClick={() => setConfirmingDelete(false)}
          />
          <Button
            design="primary"
            size="small"
            text={translateCampaignKey(t, CAMPAIGN_KEYS.delete)}
            onClick={() => { setConfirmingDelete(false); onDelete?.() }}
          />
        </Box>
      )}

      <Box gap="sm">
        <div className="flex items-center gap-2">
          <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.status)}: </text.strong>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <text.span as="caption">
          <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.schedule)}: </text.strong>
          {formatCampaignScheduleRange(intl, t, campaign.startDate, campaign.endDate)}
        </text.span>
        <text.span as="caption">
          <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.goal)}: </text.strong>
          {campaign.offer}
        </text.span>
        {campaign.landingPagePath && (
          <text.span as="caption" emphasis="passive">
            {translateCampaignKey(t, CAMPAIGN_KEYS.landingPage, { path: campaign.landingPagePath })}
          </text.span>
        )}
      </Box>

      <Box gap="md">
        <text.span as="caption">
          <text.strong as="caption">{translateCampaignKey(t, CAMPAIGN_KEYS.reviewHeading)}:</text.strong>
        </text.span>

        {assets.length === 0 ? (
          <Card space={{ block: 'lg', inline: 'md' }}>
            <Box inlineAlignChildren="center">
              <text.span emphasis="passive">{translateCampaignKey(t, CAMPAIGN_KEYS.noContent)}</text.span>
            </Box>
          </Card>
        ) : (
          <Box gap="lg">
            {assets.map((asset) => (
              <CampaignAssetRow key={asset.id} asset={asset} onEditAsset={onEditAsset} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}
