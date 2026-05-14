'use client'

import { CheckCircle, Expand, FileText, Globe, Image, XCircle } from 'lucide-react'
import { useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Tag from '@ux/tag'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/**
 * Custom renderer for websiteRebuild tool
 *
 * Shows rebuild progress and completion status.
 * Allows viewing the generated homepage prompt in a modal.
 */
export default function WebsiteRebuildToolRenderer({
  toolName: _toolName,
  toolStatus,
  toolId,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)

  // Extract data from input/result
  const sourceUrl = (input as any)?.url || (result as any)?.sourceUrl || ''
  const pagesFound = (result as any)?.pagesFound || 0
  const pagesScraped = (result as any)?.pagesScraped || 0
  const assetsFound = (result as any)?.assetsFound || 0
  const assetsByType = (result as any)?.assetsByType || { image: 0, font: 0, icon: 0, other: 0 }
  const assets = (result as any)?.assets || []
  const homepagePrompt = (result as any)?.homepagePrompt || ''
  const errorMessage = (result as any)?.error || ''
  const userMessage = (result as any)?.userMessage || t('builder_status_error')
  const isUserFacingError = (result as any)?.isUserFacingError === true
  const isSuccess = (result as any)?.success === true

  // Extract domain from URL for display
  const domain = (() => {
    try {
      return new URL(sourceUrl).hostname
    } catch {
      return sourceUrl
    }
  })()

  // Determine display state
  const isRunning = toolStatus === 'running'
  const isError = toolStatus === 'error' || !!errorMessage
  const isComplete = !isRunning && !isError && isSuccess

  // Build display name based on state
  let displayName = t('builder_rebuild_analyzing_website')
  if (isComplete) {
    displayName = t('builder_rebuild_domain_analyzed', { domain })
  } else if (isError) {
    displayName = t('builder_rebuild_failed_analyze', { domain })
  } else if (domain) {
    displayName = t('builder_rebuild_analyzing_domain', { domain })
  }

  const hasDetails = Boolean(sourceUrl || pagesFound > 0 || homepagePrompt)

  function getAssetTypeDisplay(asset: { type?: string }): { emphasis: 'info' | 'success' | undefined; label: string } {
    const type = asset.type
    if (type === 'image') return { emphasis: 'info', label: t('builder_rebuild_asset_type_image') }
    if (type === 'font') return { emphasis: 'info', label: t('builder_rebuild_asset_type_font') }
    if (type === 'icon') return { emphasis: 'success', label: t('builder_rebuild_asset_type_icon') }
    if (!type) return { emphasis: undefined, label: t('builder_rebuild_asset_type_other') }
    return { emphasis: undefined, label: type }
  }

  return (
    <div>
      <ToolHeader
        icon={<Globe className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* Summary info when complete */}
      {isComplete && (
        <Box
          orientation="vertical"
          gap="sm"
          className="ml-1 mt-1 pl-2 border-l-1 border-intents-ux-box-borderColor"
        >
          <Box orientation="horizontal" gap="sm">
            <CheckCircle className="w-2 h-2" />
            <text.p size={-1}>
              {t('builder_rebuild_pages_captured_summary', { count: pagesScraped })}
            </text.p>
          </Box>
          {assetsFound > 0 && (
            <Box orientation="horizontal" gap="sm">
              <Image className="w-2 h-2" /> {/* eslint-disable-line jsx-a11y/alt-text */}
              <text.p size={-1}>
                {t('builder_rebuild_assets_found_summary', { count: assetsFound })}
              </text.p>
            </Box>
          )}
          {homepagePrompt && (
            <Button
              text={t('builder_rebuild_view_prompt')}
              design="inline"
              size="sm"
              onClick={() => setIsPromptModalOpen(true)}
              icon={<FileText className="!w-2 !h-2" />}
            />
          )}
        </Box>
      )}

      {/* Error info */}
      {isError && (
        <Box orientation="horizontal" gap="sm" className="mt-1 pl-4">
          <XCircle className="w-3 h-3" />
          <text.p size={-1} emphasis="critical">
            {userMessage}
          </text.p>
        </Box>
      )}

      {/* Details modal */}
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('builder_rebuild_modal_title', { domain })}
      >
        <Box gap="md" className="flex-1 overflow-y-auto">
          {/* Status */}
          <Box orientation="horizontal" gap="sm">
            {isComplete && <CheckCircle className="w-4 h-4" />}
            {isError && <XCircle className="w-4 h-4" />}
            <text.p size={0}>
              {isComplete ? t('builder_rebuild_analysis_complete') : isError ? t('builder_rebuild_analysis_failed') : t('builder_rebuild_analyzing')}
            </text.p>
          </Box>

          {/* Source URL */}
          {sourceUrl && (
            <Box gap="sm">
              <text.p size={0}>{t('builder_rebuild_source_url')}</text.p>
              <Button
                text={sourceUrl}
                design="inline"
                size="sm"
                onClick={() => window.open(sourceUrl, '_blank', 'noopener,noreferrer')}
              />
            </Box>
          )}

          {/* Stats */}
          {(pagesFound > 0 || pagesScraped > 0 || assetsFound > 0) && (
            <Box orientation="horizontal" gap="lg" wrap>
              <Box gap="sm">
                <text.p size={0}>{t('builder_rebuild_pages_found')}</text.p>
                <text.h3 size={2}>{pagesFound}</text.h3>
              </Box>
              <Box gap="sm">
                <text.p size={0}>{t('builder_rebuild_pages_captured')}</text.p>
                <text.h3 size={2}>{pagesScraped}</text.h3>
              </Box>
              <Box gap="sm">
                <text.p size={0}>{t('builder_rebuild_assets_found')}</text.p>
                <text.h3 size={2}>{assetsFound}</text.h3>
              </Box>
            </Box>
          )}

          {/* Assets by type */}
          {assetsFound > 0 && (
            <Box gap="sm">
              <text.p size={0}>{t('builder_rebuild_assets_by_type')}</text.p>
              <Box orientation="horizontal" gap="sm" wrap>
                {assetsByType.image > 0 && (
                  <Tag emphasis="info">{t('builder_rebuild_count_images', { count: assetsByType.image })}</Tag>
                )}
                {assetsByType.font > 0 && (
                  <Tag emphasis="info">{t('builder_rebuild_count_fonts', { count: assetsByType.font })}</Tag>
                )}
                {assetsByType.icon > 0 && (
                  <Tag emphasis="success">{t('builder_rebuild_count_icons', { count: assetsByType.icon })}</Tag>
                )}
                {assetsByType.other > 0 && (
                  <Tag>{t('builder_rebuild_count_other', { count: assetsByType.other })}</Tag>
                )}
              </Box>
            </Box>
          )}

          {/* Assets list */}
          {assets.length > 0 && (
            <Box gap="sm">
              <text.p size={0}>{t('builder_rebuild_downloaded_assets')}</text.p>
              <Box className="bg-muted p-2 rounded border border-border max-h-48 overflow-y-auto">
                <Box gap="sm">
                  {assets.map((asset: any, index: number) => {
                    const { emphasis, label } = getAssetTypeDisplay(asset)
                    return (
                    <Box key={index} orientation="horizontal" gap="sm">
                      <Tag emphasis={emphasis}>
                        {label}
                      </Tag>
                      <Box gap="sm" className="flex-1 min-w-0">
                        <text.p size={-1} emphasis="passive" className="truncate" title={asset.url}>
                          {asset.localPath?.replace('.source-site/assets/', '/assets/') || asset.url}
                        </text.p>
                        {asset.dimensions && (
                          <text.p size={-2} emphasis="passive">
                            {asset.dimensions.width}×{asset.dimensions.height}px
                          </text.p>
                        )}
                        {asset.description && (
                          <text.p size={-2} emphasis="passive" className="truncate" title={asset.description}>
                            {asset.description}
                          </text.p>
                        )}
                      </Box>
                    </Box>
                  )
                  })}
                </Box>
              </Box>
            </Box>
          )}

          {/* Error details */}
          {isError && (
            <Box gap="sm">
              <text.p size={0} emphasis="critical">{userMessage}</text.p>
              {errorMessage && !isUserFacingError && (
                <Box className="bg-muted border border-border p-2 rounded">
                  <text.p size={-1} emphasis="critical" className="font-mono whitespace-pre-wrap">
                    {errorMessage}
                  </text.p>
                </Box>
              )}
            </Box>
          )}

          {/* Prompt preview */}
          {homepagePrompt && (
            <Box gap="sm">
              <Box orientation="horizontal" blockAlignChildren="center" inlineAlignChildren="center">
                <text.p size={0}>{t('builder_rebuild_generated_prompt')}</text.p>
                <Button
                  text={t('builder_rebuild_view_full')}
                  design="tertiary"
                  size="sm"
                  onClick={() => {
                    setIsModalOpen(false)
                    setIsPromptModalOpen(true)
                  }}
                  icon={<Expand className="w-3 h-3" />}
                />
              </Box>
              <Box className="bg-muted p-2 rounded border border-border max-h-32 overflow-hidden relative">
                <text.p size={-1} className="font-mono whitespace-pre-wrap">
                  {homepagePrompt.substring(0, 500)}...
                </text.p>
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted to-transparent" />
              </Box>
            </Box>
          )}
        </Box>
      </ToolModal>

      {/* Full prompt modal */}
      <ToolModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        title={t('builder_rebuild_generated_homepage_prompt')}
      >
        <Box gap="sm" className="flex-1 overflow-y-auto">
          <Box orientation="horizontal" inlineAlignChildren="end">
            <Button
              text={t('builder_common_copy_clipboard')}
              design="tertiary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(homepagePrompt)
              }}
            />
          </Box>
          <Box className="bg-muted p-3 rounded border border-border">
            <text.p size={-1} className="font-mono whitespace-pre-wrap">
              {homepagePrompt}
            </text.p>
          </Box>
        </Box>
      </ToolModal>
    </div>
  )
}
