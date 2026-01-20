'use client'

import { CheckCircle, Expand, FileText, Globe, Image,XCircle } from 'lucide-react'
import { useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Tag from '@ux/tag'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
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
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)
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
  let displayName = 'Analyzing website...'
  if (isComplete) {
    displayName = `Analyzed ${domain}`
  } else if (isError) {
    displayName = `Failed to analyze ${domain}`
  } else if (domain) {
    displayName = `Analyzing ${domain}...`
  }

  const hasDetails = Boolean(sourceUrl || pagesFound > 0 || homepagePrompt)

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
        <Box orientation="horizontal" gap="md" className="mt-1 pl-4">
          <Box orientation="horizontal" gap="sm">
            <CheckCircle className="w-3 h-3" />
            <text.p size={-1} emphasis="passive">
              {pagesScraped} page{pagesScraped !== 1 ? 's' : ''} captured
            </text.p>
          </Box>
          {assetsFound > 0 && (
            <Box orientation="horizontal" gap="sm">
              <Image className="w-3 h-3" /> {/* eslint-disable-line jsx-a11y/alt-text */}
              <text.p size={-1} emphasis="passive">
                {assetsFound} asset{assetsFound !== 1 ? 's' : ''} found
              </text.p>
            </Box>
          )}
          {homepagePrompt && (
            <Button
              text="View prompt"
              design="tertiary"
              size="sm"
              onClick={() => setIsPromptModalOpen(true)}
              icon={<FileText className="w-3 h-3" />}
            />
          )}
        </Box>
      )}

      {/* Error info */}
      {isError && errorMessage && (
        <Box orientation="horizontal" gap="sm" className="mt-1 pl-4">
          <XCircle className="w-3 h-3" />
          <text.p size={-1} emphasis="critical">
            {errorMessage.length > 50 ? errorMessage.substring(0, 50) + '...' : errorMessage}
          </text.p>
        </Box>
      )}

      {/* Details modal */}
      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Website Analysis: ${domain}`}
      >
        <Box gap="md" className="flex-1 overflow-y-auto">
          {/* Status */}
          <Box orientation="horizontal" gap="sm">
            {isComplete && <CheckCircle className="w-4 h-4" />}
            {isError && <XCircle className="w-4 h-4" />}
            <text.p size={0}>
              {isComplete ? 'Analysis Complete' : isError ? 'Analysis Failed' : 'Analyzing...'}
            </text.p>
          </Box>

          {/* Source URL */}
          {sourceUrl && (
            <Box gap="sm">
              <text.p size={0}>Source URL</text.p>
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
                <text.p size={0}>Pages Found</text.p>
                <text.h3 size={2}>{pagesFound}</text.h3>
              </Box>
              <Box gap="sm">
                <text.p size={0}>Pages Captured</text.p>
                <text.h3 size={2}>{pagesScraped}</text.h3>
              </Box>
              <Box gap="sm">
                <text.p size={0}>Assets Found</text.p>
                <text.h3 size={2}>{assetsFound}</text.h3>
              </Box>
            </Box>
          )}

          {/* Assets by type */}
          {assetsFound > 0 && (
            <Box gap="sm">
              <text.p size={0}>Assets by Type</text.p>
              <Box orientation="horizontal" gap="sm" wrap>
                {assetsByType.image > 0 && (
                  <Tag emphasis="info">{`${assetsByType.image} images`}</Tag>
                )}
                {assetsByType.font > 0 && (
                  <Tag emphasis="info">{`${assetsByType.font} fonts`}</Tag>
                )}
                {assetsByType.icon > 0 && (
                  <Tag emphasis="success">{`${assetsByType.icon} icons`}</Tag>
                )}
                {assetsByType.other > 0 && (
                  <Tag>{`${assetsByType.other} other`}</Tag>
                )}
              </Box>
            </Box>
          )}

          {/* Assets list */}
          {assets.length > 0 && (
            <Box gap="sm">
              <text.p size={0}>Downloaded Assets</text.p>
              <Box className="bg-muted p-2 rounded border border-border max-h-48 overflow-y-auto">
                <Box gap="sm">
                  {assets.map((asset: any, index: number) => (
                    <Box key={index} orientation="horizontal" gap="sm">
                      <Tag
                        emphasis={
                          asset.type === 'image' ? 'info' :
                          asset.type === 'font' ? 'info' :
                          asset.type === 'icon' ? 'success' :
                          undefined
                        }
                      >
                        {asset.type}
                      </Tag>
                      <Box gap="sm" className="flex-1 min-w-0">
                        <text.p size={-1} emphasis="passive" className="truncate" title={asset.url}>
                          {asset.localPath?.replace('.source-site/assets/', '/source-assets/') || asset.url}
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
                  ))}
                </Box>
              </Box>
            </Box>
          )}

          {/* Error details */}
          {errorMessage && (
            <Box gap="sm">
              <text.p size={0} emphasis="critical">{t('builder_status_error')}</text.p>
              <Box className="bg-muted border border-border p-2 rounded">
                <text.p size={-1} emphasis="critical" className="font-mono whitespace-pre-wrap">
                  {errorMessage}
                </text.p>
              </Box>
            </Box>
          )}

          {/* Prompt preview */}
          {homepagePrompt && (
            <Box gap="sm">
              <Box orientation="horizontal" blockAlignChildren="center" inlineAlignChildren="center">
                <text.p size={0}>Generated Prompt</text.p>
                <Button
                  text="View full"
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
        title="Generated Homepage Prompt"
      >
        <Box gap="sm" className="flex-1 overflow-y-auto">
          <Box orientation="horizontal" inlineAlignChildren="end">
            <Button
              text="Copy to clipboard"
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
