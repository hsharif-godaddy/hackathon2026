'use client'

import { useCallback, useMemo, useState } from 'react'
import { isRestoreMetadata } from '@airo/shared/websocket'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import { extractChatTurnCommits } from '@/hooks/useHeadUndoAction'
import { type RestoreCommitResult,useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
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

export interface UndoAction {
  isLocked: boolean
  isPending: boolean
  error: string | null
  clearError: () => void
  triggerUndo: () => void
}

/**
 * Single-button undo for the most recent user prompt. Routes through the
 * unified `/git/restore` endpoint via `useRestoreCommitMutation` — the same
 * hook the per-prompt Restore button uses — so the server handles the full
 * sequence: stash any uncommitted work, rewind to the target, persist a
 * synthetic user-action notice, and return it for the client to mirror.
 *
 * Branches:
 *  1. Streaming → await `stopGeneration` ack (bounded by a 5s timeout, and
 *     transport rejections are absorbed) before firing the rewind. We always
 *     fire regardless of how the ack settles — the user clicked, so silence
 *     would be the worst outcome — but we wait so the agent's AbortController
 *     has fired before the stash runs; otherwise in-flight tool writes race
 *     the rewind and re-dirty the tree.
 *  2. Idle → fire the rewind immediately.
 *
 * `rollbackTargetHash` is resolved against the actual git DAG, not the chat
 * transcript: find the most recent regular user prompt, find the assistant
 * turn that responded to it, and return that assistant commit's *parent*
 * from `useGitHistoryQuery`. The parent is the pre-prompt HEAD regardless of
 * any in-app editor commits, asset uploads, or external git activity that
 * happened between agent turns.
 *
 * Lock conditions (when locked, `StreamingMessageList` falls back to the
 * Restore icon — preview an older version — instead of hiding the action):
 *  - No app id, or a mutation is already in flight.
 *  - Tail of the transcript is a restore notice (nothing further to undo
 *    until the user sends another prompt).
 *  - No rollback target — the agent hasn't committed yet (in-flight, errored,
 *    or parent not loaded in the current history page). Clicking would only
 *    do a stash-only no-op when the tree is clean, which the user perceives
 *    as the button "doing nothing".
 *  - HEAD has drifted off the responding assistant's commit. Editor edits,
 *    asset uploads, or external commits have landed since; rewinding to the
 *    pre-prompt parent would silently discard that intervening work, so
 *    Undo isn't safe. Restore (preview-only) is the right action here.
 *
 * On success, the persisted notice row returned by `/git/restore` is mirrored
 * into the streaming conversation store via `addCompletedMessage` so the
 * transcript reflects the rollback immediately. Diff text is fetched lazily
 * by `UserActionDiffRenderer` when the user expands the card.
 */
export function useUndoAction(): UndoAction {
  const appIdFromParams = useAppIdFromParams()
  const t = useTranslations()

  const isStreaming = useIsActivelyStreaming()
  const messages = useMessages()
  const { stopGeneration } = useWebSocketContext()
  const addCompletedMessage = useStreamingConversationStore((s) => s.addCompletedMessage)
  const clearActiveStream = useStreamingConversationStore((s) => s.clearActiveStream)

  const restoreMutation = useRestoreCommitMutation()
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => setError(null), [])

  const pushRedo = useGitStore((s) => s.pushRedo)
  const setUndoCursor = useGitStore((s) => s.setUndoCursor)

  const { data: gitHistoryData } = useGitHistoryQuery({
    appId: appIdFromParams ?? '',
    enabled: !!appIdFromParams,
  })

  // The commit produced by the assistant turn that responded to the most
  // recent user prompt (skipping restore notices). Drives both the rollback
  // target lookup and the HEAD-drift check.
  //
  // user-stopped fallback: when the user clicks Stop, the server still runs
  // the end-of-turn squash and commits at HEAD — but the late terminal that
  // would have carried that commitHash is suppressed by the supersededSuccess
  // gate in MessageExecutionService (stop() vacates the activeStreams slot
  // before the late publish, so it looks like a new-turn supersession). The
  // client-side message therefore has `userStopped: true` with no commitHash.
  // Without a fallback, rollbackTargetHash is null and Undo locks — even
  // though there's a real squash commit at HEAD that could be rewound.
  // Infer the squash commit by taking HEAD if-and-only-if HEAD is exactly
  // one commit past the prior committed turn — any further drift means
  // editor or asset activity landed since the stop and Undo isn't safe.
  const respondingAssistantCommit = useMemo<string | null>(() => {
    const lastUserPromptIndex = messages.findLastIndex(
      (m) => m.role === 'user' && !isRestoreMetadata(m.metadata),
    )
    if (lastUserPromptIndex === -1) return null

    const responseAssistant = messages
      .slice(lastUserPromptIndex + 1)
      .find((m) => m.role === 'assistant' && typeof m.commitHash === 'string' && m.commitHash.length > 0)
    if (responseAssistant?.commitHash) return responseAssistant.commitHash

    const userStoppedResponse = messages
      .slice(lastUserPromptIndex + 1)
      .find((m) => m.role === 'assistant' && m.userStopped === true)
    if (!userStoppedResponse) return null

    let priorAssistantCommit: string | null = null
    for (let i = lastUserPromptIndex - 1; i >= 0; i--) {
      const m = messages[i]
      if (m && m.role === 'assistant' && typeof m.commitHash === 'string' && m.commitHash.length > 0) {
        priorAssistantCommit = m.commitHash
        break
      }
    }
    if (!priorAssistantCommit) return null

    const commits = gitHistoryData?.commits
    if (!commits || commits.length < 2) return null
    if (commits[1]?.hash !== priorAssistantCommit) return null

    return commits[0]?.hash ?? null
  }, [messages, gitHistoryData])

  // Look up the responding assistant's parent in the (reverse-chronological)
  // git history — that's the pre-prompt HEAD, the "last known valid state"
  // we'd rewind to.
  const rollbackTargetHash = useMemo<string | null>(() => {
    const commits = gitHistoryData?.commits
    if (!commits || commits.length === 0) return null
    if (!respondingAssistantCommit) return null

    const assistantCommitIndex = commits.findIndex((c) => c.hash === respondingAssistantCommit)
    if (assistantCommitIndex < 0) return null

    const parent = commits[assistantCommitIndex + 1]
    return parent?.hash ?? null
  }, [respondingAssistantCommit, gitHistoryData])

  // True when HEAD is no longer at the responding assistant's commit —
  // editor edits, asset uploads, or external commits landed on top. Undo
  // would skip past that intervening work, so it's not safe; the caller
  // should fall back to Restore (preview-only).
  const headHasDrifted = useMemo<boolean>(() => {
    const head = gitHistoryData?.currentCommit
    if (!head || !respondingAssistantCommit) return false
    return head !== respondingAssistantCommit
  }, [gitHistoryData?.currentCommit, respondingAssistantCommit])

  // If the tail of the transcript is already a restore message (the user
  // hasn't typed a new prompt since the last undo/restore), there's nothing
  // further to undo.
  const isLatestMessageRestoreMessage = useMemo<boolean>(() => {
    // If there is no messages just assume we want to lock the button.
    if (messages.length == 0) return true;
    const latest = messages[messages.length - 1]
    return !!latest && isRestoreMetadata(latest.metadata)
  }, [messages])

  // Lock the button whenever Undo wouldn't actually rewind the agent's
  // last action to a known valid state. See hook docstring for the full
  // rationale on each clause.
  const isLocked =
    !appIdFromParams ||
    restoreMutation.isPending ||
    isLatestMessageRestoreMessage ||
    rollbackTargetHash === null ||
    headHasDrifted

  const setRestoreError = useCallback(
    (mutationError: unknown, appId: string) => {
      logger.error('use-undo-action.rewind-failed', {
        appId,
        error: mutationError instanceof Error ? mutationError.message : String(mutationError),
      })
      logClickEvent('develop.chat.undo_error')()
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
        logger.warn('use-undo-action.mirror-notice.skipped', {
          reason: 'no notice in response — server skipped persistence (no conversation) or returned an unparseable shape',
        })
        return
      }
      // Drop any in-flight stream before appending the notice. The aborted
      // turn's terminal `complete` event arrives independently over WS — if
      // it lands AFTER this append, `finalizeStream` would push the (now-
      // rolled-back) assistant message past the notice, which both unlocks
      // the Undo button and buries the notice. Clearing activeStream makes
      // a late `complete` short-circuit (`finalizeStream` early-returns when
      // activeStream is null), so the notice stays at the tail.
      clearActiveStream()
      const synthetic: ChatMessage = {
        id: notice.id,
        role: notice.role,
        content: notice.content,
        timestamp: new Date(notice.createdAt),
        // ChatMessage.metadata carries an index signature for forward-compat
        // fields; the user-action shape is a subset and assigns through a
        // shallow spread cleanly.
        metadata: notice.metadata ? { ...notice.metadata } : undefined,
      }
      addCompletedMessage(synthetic)
      logger.info('use-undo-action.mirror-notice.added', {
        noticeId: notice.id,
        commitHash: notice?.metadata?.commitHash,
        restoredCommitHash: notice?.metadata?.restoredCommitHash,
        stashHash: notice?.metadata?.stashHash,
      })
      logClickEvent('develop.chat.undo_complete')()
    },
    [addCompletedMessage, clearActiveStream],
  )

  const triggerUndo = useCallback(() => {
    if (!appIdFromParams) return
    setError(null)
    const appId = appIdFromParams

    // Prefer git HEAD — on local dev respondingAssistantCommit is a dangling branch SHA.
    const preUndoHead = gitHistoryData?.currentCommit ?? respondingAssistantCommit
    // Cursor advances to the previous chat turn — exclude Restore SHAs that the
    // agents service may have stamped on intermediate text messages.
    const restoreShas = new Set(
      (gitHistoryData?.commits ?? [])
        .filter((c) => typeof c.message === 'string' && c.message.startsWith('Restore:'))
        .map((c) => c.hash),
    )
    const chatTurns = extractChatTurnCommits(messages, restoreShas)
    const newCursor = chatTurns[1] ?? null

    logClickEvent('develop.chat.undo', {
      hadRollbackTarget: rollbackTargetHash !== null,
      wasStreaming: isStreaming,
    })()

    const runRewind = (commitHash?: string) => {
      restoreMutation.mutate(
        { appId, ...(commitHash ? { commitHash } : {}) },
        {
          onSuccess: (result) => {
            mirrorNotice(result)
            // Skip seeding for stash-only undos (no restoredCommitHash).
            const restoredTo = result.notice?.metadata?.restoredCommitHash
            if (preUndoHead && restoredTo) {
              pushRedo(appId, preUndoHead)
              if (newCursor) setUndoCursor(appId, newCursor)
            }
          },
          onError: (mutationError) => setRestoreError(mutationError, appId),
        },
      )
    }

    if (isStreaming) {
      // Wait for the server to ack the abort before rolling back the tree —
      // otherwise the agent's in-flight tool calls race the stash and we
      // re-dirty the working directory the moment after we cleaned it. Bound
      // the wait with a timeout (and absorb any transport rejection) so a
      // missing ack never leaves Undo silently broken — the user clicked, so
      // we always fire the rewind regardless of how the ack settles.
      const STOP_GENERATION_ACK_TIMEOUT_MS = 5000
      const stopAck = stopGeneration()
        .then(() => 'acked' as const)
        .catch((err: unknown): 'failed' => {
          logger.warn('use-undo-action.stop-generation.failed', {
            appId,
            error: err instanceof Error ? err.message : String(err),
          })
          return 'failed'
        })
      const ackOrTimeout = Promise.race<'acked' | 'failed' | 'timeout'>([
        stopAck,
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), STOP_GENERATION_ACK_TIMEOUT_MS),
        ),
      ])
      void ackOrTimeout.then((outcome) => {
        if (outcome === 'timeout') {
          logger.warn('use-undo-action.stop-generation.ack-timeout', {
            appId,
            timeoutMs: STOP_GENERATION_ACK_TIMEOUT_MS,
          })
        }
        runRewind(rollbackTargetHash)
      })
      return
    }

    runRewind(rollbackTargetHash)
  }, [
    appIdFromParams,
    isStreaming,
    rollbackTargetHash,
    respondingAssistantCommit,
    stopGeneration,
    restoreMutation,
    mirrorNotice,
    setRestoreError,
    pushRedo,
    setUndoCursor,
  ])

  return {
    isLocked,
    isPending: restoreMutation.isPending,
    error,
    clearError,
    triggerUndo,
  }
}
