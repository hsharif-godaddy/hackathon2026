'use client'

import { useEffect } from 'react'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { useRebuildBuildQueue } from './useRebuildBuildQueue'

/** If a dispatched send hasn't started a turn within this window, treat it as a
 *  no-op (transport not ready) and recover. ~one slow turn-start, generously. */
const SEND_WATCHDOG_MS = 8000

/**
 * Drives the sequential multi-page rebuild queue. Mount ONCE in `ChatInput` — it
 * always renders (mobile XOR desktop, inside ChatContext) regardless of the
 * `airo-builder-chat-plans` flag, whereas the selector card enqueues regardless of
 * that flag. Do NOT mount it in the selector card (unmounts when no longer the last
 * message) or in `InputActionsPanel` (renders only behind the flag, AND inside
 * ChatInput — a second mount there would double-send every page). When a batch is
 * running and the stream is idle, it sends the next page's existing deterministic
 * message (Slice 1 path) and lets the store advance on turn completion.
 */
export function useRebuildBuildQueueDriver(): void {
  const send = useSendUserMessage()
  const multipageEnabled = useSwitchboard('appbuilder-rebuild-multipage')
  const isActivelyStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isActivelyStreaming || isLoading
  const status = useRebuildBuildQueue((s) => s.status)
  const phase = useRebuildBuildQueue((s) => s.phase)
  const slugs = useRebuildBuildQueue((s) => s.slugs)
  const cursor = useRebuildBuildQueue((s) => s.cursor)
  const markSent = useRebuildBuildQueue((s) => s.markSent)
  const onProcessingChange = useRebuildBuildQueue((s) => s.onProcessingChange)
  const onSendStalled = useRebuildBuildQueue((s) => s.onSendStalled)

  // Feed stream-busy transitions into the store's state machine.
  useEffect(() => {
    onProcessingChange(isProcessing)
  }, [isProcessing, onProcessingChange])

  // Watchdog: a send can no-op (transport not ready — e.g. socket reconnecting
  // between turns), in which case no turn starts and `isProcessing` never goes
  // true, so `phase` is stuck at 'sent' with no edge to advance it. After a
  // timeout, recover (retry, then give up) instead of freezing silently. The
  // timer re-arms each time we enter 'sent' (phase/cursor deps) and is cleared
  // when the turn starts (phase → 'in-turn') or the batch ends.
  useEffect(() => {
    if (status !== 'running' || phase !== 'sent') return
    const id = setTimeout(onSendStalled, SEND_WATCHDOG_MS)
    return () => clearTimeout(id)
  }, [status, phase, cursor, onSendStalled])

  // Send the next page's message when the batch is running and the stream is idle.
  useEffect(() => {
    if (!multipageEnabled || status !== 'running' || phase !== 'awaiting-send' || isProcessing || !send) return
    const slug = slugs[cursor]
    if (!slug) return
    void send(`Build the ${slug} page`, { isActionRequest: true, rebuildBuildPageSlug: slug })
    markSent()
  }, [multipageEnabled, status, phase, isProcessing, slugs, cursor, send, markSent])
}
