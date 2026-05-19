'use client'

import { Rocket } from 'lucide-react'
import { useEffect, useRef } from 'react'

import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility'
import { useTranslations } from '@/hooks/useTranslations'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Input type for publishClient tool
 */
interface PublishClientInput {
  commitHash?: string
}

/**
 * Extract commit SHA from tool result.
 *
 * Supports three shapes (in priority order):
 *   1. Object result with `commitHash` — returned by the `publishing__publish`
 *      skill tool.
 *   2. String result with archive path `/publish/dist/{fullSHA}.tar.gz` — full
 *      40-char hash from the legacy `publishClient` tool.
 *   3. String result with `Successfully published commit {sha}` (legacy) or
 *      `Published commit {sha}` (skill tool) message prefix.
 */
export function extractCommitHash(result: string | Record<string, unknown> | undefined, input: PublishClientInput): string | undefined {
  if (!result) return input?.commitHash

  if (typeof result === 'object' && typeof result.commitHash === 'string') {
    return result.commitHash
  }

  if (typeof result === 'string') {
    const archiveMatch = result.match(/\/publish\/dist\/([a-f0-9]{40})\.tar\.gz/i)
    if (archiveMatch) {
      return archiveMatch[1]
    }

    const commitMatch = result.match(/(?:Successfully p|P)ublished commit ([a-f0-9]{7,40})/i)
    if (commitMatch) {
      return commitMatch[1]
    }
  }

  return input?.commitHash
}

/**
 * Custom renderer for publishClient tool
 *
 * Shows publishing status with deployment information
 */
export default function PublishClientToolRenderer({
  toolStatus,
  toolId,
  isLastAssistantMessage,
  input,
  result,
  error,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const currentAppId = useDevelopPageStore((state) => state.currentAppId)
  const requestPublishPopoverOpen = useDevelopPageStore((state) => state.requestPublishPopoverOpen)
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility()
  const hasHandledRef = useRef(false)
  const lastLoggedErrorRef = useRef<string | null>(null)

  // Parse input with proper typing
  const inputData = input as PublishClientInput

  // Extract commit hash from result string or input
  const commitHash = extractCommitHash(result, inputData)

  useEffect(() => {
    hasHandledRef.current = false
  }, [toolId])

  useEffect(() => {
    if (
      !currentAppId ||
      !isLastAssistantMessage ||
      toolStatus !== 'running' ||
      isPaywallLoading ||
      hasHandledRef.current
    ) {
      return
    }
    hasHandledRef.current = true

    if (showPaywall) {
      openUpgradeModal('publish', PAYWALL_ITC.PUBLISH)
    } else {
      requestPublishPopoverOpen(currentAppId)
    }
  }, [currentAppId, isLastAssistantMessage, isPaywallLoading, openUpgradeModal, requestPublishPopoverOpen, showPaywall, toolStatus])

  useEffect(() => {
    if (!currentAppId || !error || error === lastLoggedErrorRef.current) return
    logger.error('publish-client-tool-renderer.tool-error', { appId: currentAppId, error, toolStatus })
    lastLoggedErrorRef.current = error
  }, [currentAppId, error, toolStatus])

  const resultFailed = typeof result === 'object' && result && (result as Record<string, unknown>).success === false

  const getDisplayText = () => {
    if (toolStatus === 'running') {
      return commitHash
        ? t('builder_tools_publish_running_commit', { commit: commitHash.substring(0, 7) }, `Publishing commit ${commitHash.substring(0, 7)}...`)
        : t('builder_tools_publish_running', void 0, 'Publishing...')
    }

    if (toolStatus === 'error' || resultFailed) {
      return t('builder_tools_publish_failed', void 0, 'Publish failed')
    }

    // Completed successfully
    return commitHash
      ? t('builder_tools_publish_success_commit', { commit: commitHash.substring(0, 7) }, `Published commit ${commitHash.substring(0, 7)}`)
      : t('builder_tools_publish_success', void 0, 'Published successfully')
  }

  return (
    <div>
      <ToolHeader
        icon={<Rocket className="w-2 h-2" />}
        displayName={getDisplayText()}
        toolStatus={toolStatus}
        hasDetails={false}
      />
    </div>
  )
}
