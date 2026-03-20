import { useCallback, useEffect, useRef } from 'react'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const EVAL_SNAPSHOT_SENT_PREFIX = 'airo_eval_snapshot_sent_'
/** Must match CompleteHandler EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX */
const EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX = 'airo_eval_snapshot_app_build_count_'

interface EvalSnapshotCaptureOptions {
  appId: string | undefined
}

/**
 * Hook for capturing eval snapshots after the first build of a new app.
 *
 * CompleteHandler fires eval-snapshot-trigger when complete includes a commitHash and the
 * per-app build count in session storage is 1 (first committed build). This hook captures
 * when that trigger fires and count === 1.
 */
export function useEvalSnapshotCapture({ appId }: EvalSnapshotCaptureOptions) {
  const captureRequestedRef = useRef(false)
  const delayTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    captureRequestedRef.current = false
    // Clear any pending timer when appId changes
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current)
      delayTimerRef.current = null
    }
  }, [appId])

  const hasAlreadyCaptured = useCallback((id: string) => {
    return sessionStorage.getItem(`${EVAL_SNAPSHOT_SENT_PREFIX}${id}`) === 'true'
  }, [])

  const markCaptured = useCallback((id: string) => {
    sessionStorage.setItem(`${EVAL_SNAPSHOT_SENT_PREFIX}${id}`, 'true')
  }, [])

  /**
   * Called when eval-snapshot-trigger fires (from CompleteHandler only when build count === 1).
   * Double-check count so we only capture on first build completion.
   * Waits for iframe to reload and render before requesting capture.
   */
  const triggerEvalSnapshot = useCallback(() => {
    if (!appId || captureRequestedRef.current || hasAlreadyCaptured(appId)) return

    const countStr = sessionStorage.getItem(`${EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX}${appId}`)
    const count = countStr ? parseInt(countStr, 10) : 0
    if (count !== 1) return

    captureRequestedRef.current = true
    logger.info('eval-snapshot.requesting', { appId })

    // Wait for iframe to reload and render content after commit
    // The commit triggers iframe navigation, so we need to give it time to load
    delayTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('eval-snapshot-request'))
      delayTimerRef.current = null
    }, 2000) // 2 second delay to allow iframe to reload and render
  }, [appId, hasAlreadyCaptured])

  /**
   * Called when VIEWPORT_SCREENSHOT_RESPONSE is received from iframe (viewport capture).
   */
  const handleEvalViewportScreenshot = useCallback(async (screenshotDataUrl: string) => {
    if (!appId || hasAlreadyCaptured(appId)) return

    markCaptured(appId)
    logger.info('eval-snapshot.upload.start', { appId })

    try {
      const store = useStreamingConversationStore.getState()
      const messages = store.messages

      // Extract initial prompt (first user message)
      const initialPrompt = messages.find(m => m.role === 'user')?.content || ''

      // Extract follow-up Q&A
      const followUpQA: Array<{ question: string; answer: string }> = []
      let foundFirstUser = false
      let pendingQuestion: string | null = null

      for (const msg of messages) {
        if (!foundFirstUser && msg.role === 'user') {
          foundFirstUser = true
          continue
        }
        if (!foundFirstUser) continue

        if (msg.role === 'assistant' && msg.content) {
          // Accumulate consecutive assistant messages into a single question
          pendingQuestion = pendingQuestion
            ? `${pendingQuestion}\n\n${msg.content}`
            : msg.content
        } else if (msg.role === 'user' && pendingQuestion) {
          followUpQA.push({ question: pendingQuestion, answer: msg.content })
          pendingQuestion = null
        }
      }

      // Preserve unanswered agent question if conversation ends with one
      if (pendingQuestion) {
        followUpQA.push({ question: pendingQuestion, answer: '' })
      }

      const manifest = {
        appId,
        timestamp: new Date().toISOString(),
        initialPrompt,
        followUpQA,
        metadata: {
          templateVersion: 'v8',
        },
      }

      // Convert data URL to Blob
      const response = await fetch(screenshotDataUrl)
      const blob = await response.blob()

      const formData = new FormData()
      formData.append('appId', appId)
      formData.append('screenshot', blob, 'screenshot.png')
      formData.append('manifest', JSON.stringify(manifest))

      const uploadResponse = await appFetch('/api/eval-snapshots', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`)
      }

      logger.info('eval-snapshot.upload.success', { appId })
    } catch (error) {
      logger.warn('eval-snapshot.upload.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [appId, hasAlreadyCaptured, markCaptured])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current)
        delayTimerRef.current = null
      }
    }
  }, [])

  return {
    triggerEvalSnapshot,
    handleEvalViewportScreenshot,
  }
}
