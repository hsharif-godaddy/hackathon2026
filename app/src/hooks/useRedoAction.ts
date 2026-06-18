'use client'

import { useCallback, useState } from 'react'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { type RestoreCommitResult, useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useGitStore } from '@/stores/useGitStore'
import {
  type ChatMessage,
  useIsActivelyStreaming,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import { logClickEvent } from '@/utils/instrumentation'

export interface RedoAction {
  isLocked: boolean
  isPending: boolean
  error: string | null
  clearError: () => void
  triggerRedo: () => void
}

/** Forward complement to `useHeadUndoAction` (AIROBUILD-1558). */
export function useRedoAction(): RedoAction {
  const appIdFromParams = useAppIdFromParams()
  const t = useTranslations()

  const isStreaming = useIsActivelyStreaming()
  const addCompletedMessage = useStreamingConversationStore((s) => s.addCompletedMessage)

  const restoreMutation = useRestoreCommitMutation()
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => setError(null), [])

  const redoStackLength = useGitStore((s) =>
    appIdFromParams ? s.redoStackByApp[appIdFromParams]?.length ?? 0 : 0,
  )
  const popRedo = useGitStore((s) => s.popRedo)
  const setUndoCursor = useGitStore((s) => s.setUndoCursor)

  const isLocked =
    !appIdFromParams ||
    restoreMutation.isPending ||
    redoStackLength === 0 ||
    isStreaming

  const setRestoreError = useCallback(
    (mutationError: unknown, appId: string) => {
      logger.error('use-redo-action.replay-failed', {
        appId,
        error: mutationError instanceof Error ? mutationError.message : String(mutationError),
      })
      logClickEvent('develop.header.redo_error')()
      setError(
        t(
          'builder_chat_redo_restore_failed',
          undefined,
          'Could not redo. Please try again or send a new message.',
        ),
      )
    },
    [t],
  )

  const mirrorNotice = useCallback(
    (result: RestoreCommitResult) => {
      const notice = result.notice
      if (!notice) {
        logger.warn('use-redo-action.mirror-notice.skipped', {
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

  const triggerRedo = useCallback(() => {
    if (!appIdFromParams) return
    setError(null)
    const appId = appIdFromParams

    const target = popRedo(appId)
    if (!target) {
      logger.warn('use-redo-action.trigger.empty-stack', { appId })
      return
    }

    logClickEvent('develop.header.redo', {
      target: target.substring(0, 7),
    })()

    restoreMutation.mutate(
      { appId, commitHash: target },
      {
        onSuccess: (result) => {
          mirrorNotice(result)
          setUndoCursor(appId, target)
        },
        onError: (mutationError) => {
          // Re-push so a retry click finds the same forward target.
          useGitStore.getState().pushRedo(appId, target)
          setRestoreError(mutationError, appId)
        },
      },
    )
  }, [appIdFromParams, popRedo, restoreMutation, mirrorNotice, setUndoCursor, setRestoreError])

  return {
    isLocked,
    isPending: restoreMutation.isPending,
    error,
    clearError,
    triggerRedo,
  }
}
