'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import Tag from '@ux/tag'
import text from '@ux/text'

interface CampaignAsset {
  id: string
  assetType: 'landing-page' | 'banner' | 'blog' | 'social' | 'email' | 'ad'
  assetRef: string
  title: string
  scheduledDate?: string
  status: 'draft' | 'scheduled' | 'published' | 'sent'
  contentPreview?: string
  imageUrl?: string
}

interface Campaign {
  id: string
  name: string
  campaignType: 'landing-page' | 'banner' | 'content-only'
  status: 'draft' | 'ready' | 'active' | 'completed' | 'archived'
  offer: string
  startDate: string
  endDate: string
  landingPagePath?: string
  assets?: CampaignAsset[]
}

interface CampaignDetailModalProps {
  campaign: Campaign
  isOpen: boolean
  onClose: () => void
  onDelete?: () => void
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  'landing-page': 'Landing Page',
  'banner': 'Banner',
  'blog': 'Blog Post',
  'social': 'Social Post',
  'email': 'Email',
  'ad': 'Ad Copy',
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

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CampaignDetailModal({ campaign, isOpen, onClose, onDelete }: CampaignDetailModalProps) {
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
        {/* Status and dates */}
        <Box orientation="horizontal" gap="sm" blockAlignChildren="center">
          <Tag emphasis={campaign.status === 'active' ? 'success' : campaign.status === 'ready' ? 'info' : campaign.status === 'draft' ? 'warning' : 'neutral'}>
            {campaign.status === 'draft' ? 'Plan Review' : campaign.status === 'ready' ? 'Ready to Launch' : campaign.status}
          </Tag>
          <text.span as="caption">
            {formatDate(campaign.startDate)} — {formatDate(campaign.endDate)}
          </text.span>
        </Box>

        {/* Offer */}
        <Box gap="sm" inlinePadding="md" blockPadding="md" className="border-0 intents-ux-boxLowContrast rounded-lg">
          <text.strong as="caption">Campaign Goal</text.strong>
          <text.p>{campaign.offer}</text.p>
          {campaign.landingPagePath && (
            <text.span as="caption" emphasis="passive">
              Landing page: {campaign.landingPagePath}
            </text.span>
          )}
        </Box>

        {/* Assets grouped by type */}
        {Object.entries(groupedAssets).map(([type, typeAssets]) => (
          <Box key={type} gap="sm">
            <text.strong as="caption">
              {ASSET_TYPE_ICONS[type] || ''} {ASSET_TYPE_LABELS[type] || type} ({typeAssets.length})
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
                        {formatDate(asset.scheduledDate)}
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
            <text.span emphasis="passive">No content pieces in this campaign yet.</text.span>
          </Box>
        )}

        {/* Actions */}
        <Box orientation="horizontal" gap="md" inlineAlignChildren="end" className="pt-2 border-t border-intents-ux-border-default">
          {onDelete && (
            <Button
              design="tertiary"
              size="sm"
              text="Delete Campaign"
              onClick={onDelete}
            />
          )}
          <Box className="flex-1" />
          <Button
            design="secondary"
            size="sm"
            text="Close"
            onClick={onClose}
          />
        </Box>
      </Box>
    </Modal>
  )
}
