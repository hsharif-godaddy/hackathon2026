'use client'

import { useState, useMemo } from 'react'
import { motion, LayoutGroup } from 'framer-motion'
import Box from '@ux/box'
import { text } from '@ux/text'
import AlertIcon from '@ux/icon/alert'
import CheckmarkIcon from '@ux/icon/checkmark'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ChevronRightIcon from '@ux/icon/chevron-right'
import ClockIcon from '@ux/icon/clock'
import MarkdownRenderer from './MarkdownRenderer'
import FullscreenModal from './FullscreenModal'
import { getToolRenderType } from './utils'
import { getToolDisplayName } from '../../../utils/toolNameMapping'

interface ToolCallMessageProps {
  toolName: string
  toolStatus: 'running' | 'success' | 'error'
  duration?: number
  toolResult?: string
  error?: string
  toolArgs?: string
}

export default function ToolCallMessage({
  toolName,
  toolStatus,
  duration,
  toolResult,
  error,
  toolArgs
}: ToolCallMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getStatusIcon = () => {
    switch (toolStatus) {
      case 'running':
        return <ClockIcon className="w-4 h-4 text-intents-ux-feedbackHighContrastInfo-feedbackColor animate-spin" />
      case 'success':
        return <CheckmarkIcon className="w-4 h-4 text-intents-ux-feedbackHighContrastSuccess-feedbackColor" />
      case 'error':
        return <AlertIcon className="w-4 h-4 text-intents-ux-feedbackHighContrastCritical-feedbackColor" />
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatArgs = (args?: string) => {
    if (!args) return ''

    try {
      const parsed = JSON.parse(args)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return args
    }
  }

  const getFileName = (toolName: string, args?: string) => {
    if ((toolName === 'file_edit' || toolName === 'file_read' || toolName === 'read_file') && args) {
      try {
        const parsed = JSON.parse(args)
        const fullPath = parsed.path || parsed.target_file || null
        if (fullPath) {
          // Extract just the filename from the path
          return fullPath.split('/').pop() || fullPath
        }
        return null
      } catch {
        return null
      }
    }
    return null
  }

  const extractImagesFromResult = (toolResult?: string) => {
    if (!toolResult) return null
    // Match all markdown image formats: ![alt text](image_url)
    const imageMatches = toolResult.matchAll(/!\[([^\]]*)\]\(([^\)]+)\)/g)
    const images = []

    for (const match of imageMatches) {
      images.push({
        alt: match[1] || 'Search result image',
        url: match[2]
      })
    }

    return images.length > 0 ? images : null
  }

  const filename = getFileName(toolName, toolArgs)
  const hasOutput = Boolean(toolResult || error)
  const layoutId = useMemo(() =>
    `tool-output-${toolName}-${toolArgs ? JSON.stringify(toolArgs).slice(0, 20) : 'no-args'}-${toolResult ? toolResult.slice(0, 20) : 'no-result'}`.replace(/[^a-zA-Z0-9-]/g, '-'),
    [toolName, toolArgs, toolResult]
  )

  return (
    <LayoutGroup>
      <div className="space-y-1">
      {/* Header */}
      <div
        className={`flex items-center justify-between py-1 ${hasOutput ? 'cursor-pointer hover:opacity-70' : ''}`}
        onClick={hasOutput ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <div className="flex items-center space-x-1">
          {getStatusIcon()}
          <div className="flex items-center space-x-2 overflow-hidden">
            <text.strong size={ -1 } className="text-sm truncate">
              {getToolDisplayName(toolName)}
              {filename && (
                <span className="text-xs ml-1 font-mono">
                  {filename}
                </span>
              )}
            </text.strong>
            {toolStatus === 'running' && (
              <span className="text-xs flex-shrink-0">
                executing...
              </span>
            )}
          </div>
        </div>

        {hasOutput && (
          <div className="flex items-center space-x-1">
            {toolStatus === 'error' && (
              <span className="text-xs text-red-600">failed</span>
            )}
            {toolStatus === 'success' && (
              <span className="text-xs text-green-600">done</span>
            )}
            {isExpanded ? (
              <ChevronDownIcon className="w-3 h-3" />
            ) : (
              <ChevronRightIcon className="w-3 h-3" />
            )}
          </div>
        )}
      </div>

      {/* Expandable content */}
      {isExpanded && hasOutput && (
        <div className="mt-2 mb-4 px-2 py-4 space-y-4 rounded-md bg-intents-ux-boxLowContrast-backgroundColor">
          {/* Duration (only shown when expanded) */}
          {duration && (
            <Box gap="sm" orientation="horizontal" className="mb-2">
              <div className="text-xs font-bold pl-2">Duration</div>
              <div className="text-xs">{formatDuration(duration)}</div>
            </Box>
          )}

          {/* Tool arguments (if available) */}
          {toolArgs && (
            <Box gap="sm">
              <div className="text-xs font-bold px-2">Arguments</div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-intents-ux-box-backgroundColor shadow-md p-2 rounded text-left max-h-32 overflow-y-auto">
                {formatArgs(toolArgs)}
              </pre>
            </Box>
          )}

          {/* Tool output */}
          <Box gap="sm">
            <div className="flex items-center justify-between px-2">
              <div className="text-xs font-bold">
                {error ? 'Error' : 'Output'}
              </div>
              {!error && toolResult && toolName !== 'image_search' && toolName !== 'imageSearch' && (
                <FullscreenModal
                  content={toolResult}
                  toolName={toolName}
                  layoutId={layoutId}
                  type={getToolRenderType(toolName)}
                />
              )}
            </div>
            {(toolName === 'image_search' || toolName === 'imageSearch') && !error && toolResult ? (
              <div className="bg-intents-ux-box-backgroundColor shadow-md">
                {(() => {
                  const images = extractImagesFromResult(toolResult)
                  if (images && images.length > 0) {
                    return (
                      <div className="p-3 rounded">
                        {/* Compact grid for multiple images */}
                        <div className={`grid gap-2 mb-3 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                          {images.map((imageData, index) => (
                            <div key={index} className="space-y-1">
                              <FullscreenModal
                                imageUrl={imageData.url}
                                imageAlt={imageData.alt}
                                title={imageData.alt}
                                type="image"
                                layoutId={`image-${index}-${layoutId}`}
                              >
                                <motion.div 
                                  className="cursor-pointer hover:opacity-80 transition-opacity"
                                  layoutId={`image-${index}-${layoutId}`}
                                >
                                  <img /* eslint-disable-line @next/next/no-img-element */
                                    src={imageData.url}
                                    alt={imageData.alt}
                                    className="w-full h-32 object-cover rounded shadow-sm"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.style.display = 'none'
                                      const fallback = target.nextSibling as HTMLElement
                                      if (fallback) fallback.style.display = 'block'
                                    }}
                                  />
                                  <div className="text-xs text-red-600 hidden p-1 bg-red-50 rounded text-center">
                                    Failed to load: {imageData.alt}
                                  </div>
                                </motion.div>
                              </FullscreenModal>
                              {imageData.alt && (
                                <p className="text-xs text-gray-600 text-center truncate">
                                  {imageData.alt}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="text-xs text-gray-600 font-mono">
                          {images.length} image{images.length !== 1 ? 's' : ''} found
                        </div>
                      </div>
                    )
                  }
                  return (
                    <pre className="text-xs whitespace-pre-wrap font-mono max-h-64 overflow-y-auto p-2 text-left">
                      {toolResult}
                    </pre>
                  )
                })()}
              </div>
            ) : getToolRenderType(toolName) === 'plain' && !error && toolResult ? (
              <div className="bg-intents-ux-box-backgroundColor shadow-md p-2 rounded max-h-64 overflow-y-auto">
                <pre className="text-xs whitespace-pre font-mono text-left overflow-x-auto">
                  {toolResult}
                </pre>
              </div>
            ) : error ? (
              <motion.div
                className="bg-intents-ux-box-backgroundColor shadow-md p-2 rounded max-h-64 overflow-y-auto"
              >
                <pre className="text-xs whitespace-pre-wrap font-mono text-red-600">
                  {error}
                </pre>
              </motion.div>
            ) : (
              <motion.div
                className="bg-intents-ux-box-backgroundColor shadow-md p-2 rounded max-h-64 overflow-y-auto"
                layoutId={toolResult ? layoutId : undefined}
              >
                <MarkdownRenderer
                  content={toolResult}
                  className="text-sm leading-relaxed break-words"
                />
              </motion.div>
            )}
          </Box>
        </div>
      )}
      </div>
    </LayoutGroup>
  )
}
