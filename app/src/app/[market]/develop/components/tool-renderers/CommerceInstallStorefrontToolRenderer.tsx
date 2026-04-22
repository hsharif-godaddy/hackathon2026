'use client'

import { useEffect, useMemo, useRef } from 'react'

import { handlePreviewRefresh } from '@/app/[market]/develop/components/utils'
import CommerceToolRenderer from './CommerceToolRenderer'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Refreshes the preview after Commerce storefront installation updates .env values
 * and restarts the preview app server.
 *
 * Vite reads VITE_* env vars at startup, so the iframe must fully reload after the
 * server restart to pick up the new configuration.
 */
export default function CommerceInstallStorefrontToolRenderer(props: DefaultToolRendererProps) {
  const { toolId, toolStatus, result, error, isLastAssistantMessage } = props

  const previewStateRef = useRef<Record<string, unknown>>({})
  const hasTriggeredRefreshRef = useRef(false)

  const resultObj = useMemo(() => {
    if (typeof result === 'object' && result !== null) {
      return result as Record<string, unknown>
    }

    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result)
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
      } catch {
        return null
      }
    }

    return null
  }, [result])

  const shouldRefreshPreview =
    isLastAssistantMessage &&
    toolStatus === 'completed' &&
    !error &&
    resultObj?.serverRestarted === true

  useEffect(() => {
    hasTriggeredRefreshRef.current = false
    previewStateRef.current = {}
  }, [toolId])

  useEffect(() => {
    if (!shouldRefreshPreview || hasTriggeredRefreshRef.current) {
      return
    }

    hasTriggeredRefreshRef.current = true
    handlePreviewRefresh({ lastIframeState: previewStateRef })
  }, [shouldRefreshPreview])

  return <CommerceToolRenderer {...props} />
}
