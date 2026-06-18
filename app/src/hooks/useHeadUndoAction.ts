'use client'

import { useCallback, useMemo, useState } from 'react'
import { isRestoreMetadata } from '@airo/shared/websocket'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { type RestoreCommitResult, useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useGitStore } from '@/stores/useGitStore'
import {
  type ChatMessage,
  useIsActivelyStreaming,
  useMessages,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import { logClickEvent } from '@/utils/instrumentation'

export interface HeadUndoAction {
  isLocked: boolean
  isPending: boolean
  error: string | null
  clearError: () => void
  triggerUndo: () => void
}

/** Undo timeline: assistant commitHashes newest-first, deduped, skipping restore notices.
 *  `knownRestoreShas` defends against intermediate agent messages whose commitHash was
 *  stamped from HEAD-at-emit-time when HEAD happened to be a Restore commit. */
export function extractChatTurnCommits(
  messages: ChatMessage[],
  knownRestoreShas: Set<string> = new Set(),
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    if (isRestoreMetadata(m.metadata)) continue
    if (typeof m.commitHash !== 'string' || m.commitHash.length === 0) continue
    if (knownRestoreShas.has(m.commitHash)) continue
    if (seen.has(m.commitHash)) continue
    seen.add(m.commitHash)
    out.push(m.commitHash)
  }
  return out
}

/** Editor-toolbar Undo (AIROBUILD-1557+1558) — walks the chat-turn timeline. */
export function useHeadUndoAction(): HeadUndoAction {
  const appIdFromParams = useAppIdFromParams()
  const t = useTranslations()

  const isStreaming = useIsActivelyStreaming()
  const messages = useMessages()
  const addCompletedMessage = useStreamingConversationStore((s) => s.addCompletedMessage)
  const restoreMutation = useRestoreCommitMutation()
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => setError(null), [])

  const pushRedo = useGitStore((s) => s.pushRedo)
  const setUndoCursor = useGitStore((s) => s.setUndoCursor)
  const storedCursor = useGitStore((s) => (appIdFromParams ? s.undoCursorByApp[appIdFromParams] ?? null : null))

  const { data: gitHistoryData, isFetching: gitHistoryFetching } = useGitHistoryQuery({
    appId: appIdFromParams ?? '',
    enabled: !!appIdFromParams,
  })

  const knownRestoreShas = useMemo(() => {
    const set = new Set<string>()
    for (const c of gitHistoryData?.commits ?? []) {
      if (typeof c.message === 'string' && c.message.startsWith('Restore:')) set.add(c.hash)
    }
    return set
  }, [gitHistoryData])

  const chatTurnCommits = useMemo<string[]>(
    () => extractChatTurnCommits(messages, knownRestoreShas),
    [messages, knownRestoreShas],
  )

  // Re-anchor to the latest turn when the stored cursor isn't in the timeline.
  const effectiveCursor = (() => {
    if (storedCursor && chatTurnCommits.includes(storedCursor)) return storedCursor
    return chatTurnCommits[0] ?? null
  })()

  const cursorParent = (() => {
    if (!effectiveCursor) return null
    const idx = chatTurnCommits.indexOf(effectiveCursor)
    if (idx < 0) return null
    return chatTurnCommits[idx + 1] ?? null
  })()

  const isLocked =
    !appIdFromParams ||
    restoreMutation.isPending ||
    isStreaming ||
    gitHistoryFetching ||
    effectiveCursor === null ||
    cursorParent === null

  const setRestoreError = useCallback(
    (mutationError: unknown, appId: string) => {
      logger.error('use-head-undo-action.rewind-failed', {
        appId,
        error: mutationError instanceof Error ? mutationError.message : String(mutationError),
      })
      logClickEvent('develop.header.undo_error')()
      setError(
        t(
          'builder_chat_undo_restore_failed',
          undefined,
          'Could not undo. Please try again or send a new message.',
        ),
      )
    },
    [t],
  )

  const mirrorNotice = useCallback(
    (result: RestoreCommitResult) => {
      const notice = result.notice
      if (!notice) {
        logger.warn('use-head-undo-action.mirror-notice.skipped', {
          reason: 'no notice in response',
        })
        return
      }
      const synthetic: ChatMessage = {
        id: notice.id,
        role: notice.role,
        content: notice.content,
        timestamp: new Date(notice.createdAt),
        metadata: notice.metadata ? { ...notice.metadata } : undefined,
      }
      addCompletedMessage(synthetic)
    },
    [addCompletedMessage],
  )

  const triggerUndo = useCallback(() => {
    if (!appIdFromParams || !effectiveCursor || !cursorParent) return
    setError(null)
    const appId = appIdFromParams
    const preUndoCursor = effectiveCursor
    const target = cursorParent

    logClickEvent('develop.header.undo', {
      cursor: preUndoCursor.substring(0, 7),
      target: target.substring(0, 7),
    })()

    restoreMutation.mutate(
      { appId, commitHash: target },
      {
        onSuccess: (result) => {
          mirrorNotice(result)
          pushRedo(appId, preUndoCursor)
          setUndoCursor(appId, target)
        },
        onError: (mutationError) => setRestoreError(mutationError, appId),
      },
    )
  }, [appIdFromParams, effectiveCursor, cursorParent, restoreMutation, mirrorNotice, pushRedo, setUndoCursor, setRestoreError])

  return {
    isLocked,
    isPending: restoreMutation.isPending,
    error,
    clearError,
    triggerUndo,
  }
}
