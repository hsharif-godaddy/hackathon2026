'use client'

import { CheckCircle, Rocket } from 'lucide-react'
import { useState } from 'react'

import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Input type for publishClient tool
 */
interface PublishClientInput {
  commitHash?: string
}

/**
 * Extract commit SHA from result string
 * Result format: "Successfully published commit abc1234\n\nArchive path: /publish/dist/abc1234567890.tar.gz"
 * Prioritizes the full 40-character hash from archive path over short hash
 */
function extractCommitHash(result: string | Record<string, unknown> | undefined, input: PublishClientInput): string | undefined {
  if (!result) return input?.commitHash

  // If result is a string, parse it
  if (typeof result === 'string') {
    // FIRST: Try to extract full 40-char hash from archive path: /publish/dist/{fullSHA}.tar.gz
    const archiveMatch = result.match(/\/publish\/dist\/([a-f0-9]{40})\.tar\.gz/i)
    if (archiveMatch) {
      return archiveMatch[1]
    }

    // FALLBACK: Extract short hash from "Successfully published commit {sha}" line
    const commitMatch = result.match(/Successfully published commit ([a-f0-9]{7,40})/i)
    if (commitMatch) {
      return commitMatch[1]
    }
  }

  // Fallback to input
  return input?.commitHash
}

/**
 * Custom renderer for publishClient tool
 *
 * Shows publishing status with deployment information
 */
export default function PublishClientToolRenderer({
  toolStatus,
  duration,
  input,
  result,
  error,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Parse input with proper typing
  const inputData = input as PublishClientInput

  // Extract commit hash from result string or input
  const commitHash = extractCommitHash(result, inputData)

  // Format duration
  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Determine display text based on status
  const getDisplayText = () => {
    if (toolStatus === 'running') {
      return commitHash
        ? t('builder_tools_publish_running_commit', { commit: commitHash.substring(0, 7) }, `Publishing commit ${commitHash.substring(0, 7)}...`)
        : t('builder_tools_publish_running', void 0, 'Publishing...')
    }

    if (toolStatus === 'error') {
      return t('builder_tools_publish_failed', void 0, 'Publish failed')
    }

    // Completed successfully
    return commitHash
      ? t('builder_tools_publish_success_commit', { commit: commitHash.substring(0, 7) }, `Published commit ${commitHash.substring(0, 7)}`)
      : t('builder_tools_publish_success', void 0, 'Published successfully')
  }

  const hasDetails = Boolean(result || error || commitHash)

  return (
    <div>
      <ToolHeader
        icon={<Rocket className="w-2 h-2" />}
        displayName={getDisplayText()}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('builder_tools_publish_title', void 0, 'Publish Details')}
      >
        <div className="flex-1 overflow-y-auto space-y-3">
          {/* Status Summary */}
          {toolStatus === 'completed' && !error && (
            <div className="bg-intents-ux-feedbackSuccess-backgroundColor border border-intents-ux-feedbackSuccess-borderColor p-2 rounded">
              <div className="flex items-center gap-2 text-sm font-medium text-intents-ux-feedbackSuccess-textColor">
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                <span>{t('builder_tools_publish_success_message', void 0, 'Successfully published')}</span>
              </div>
            </div>
          )}

          {toolStatus === 'running' && (
            <div className="bg-muted border border-border p-2 rounded">
              <div className="text-sm font-medium">
                {t('builder_tools_publish_in_progress', void 0, 'Publishing in progress...')}
              </div>
            </div>
          )}

          {/* Commit Information */}
          {commitHash && (
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase text-muted-foreground">
                {t('builder_tools_publish_commit', void 0, 'Commit')}
              </div>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded border border-border">
                  {commitHash.substring(0, 7)}
                </code>
                <span className="text-xs text-muted-foreground font-mono">
                  {commitHash}
                </span>
              </div>
            </div>
          )}

          {/* Duration */}
          {duration && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
              <span>{t('builder_tools_default_duration', void 0, 'Duration')}</span>
              <span className="font-mono">{formatDuration(duration)}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase text-destructive">
                {t('builder_status_error', void 0, 'Error')}
              </div>
              <div className="bg-destructive/10 border border-destructive/30 p-2 rounded">
                <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                  {error}
                </pre>
              </div>
            </div>
          )}
        </div>
      </ToolModal>
    </div>
  )
}
