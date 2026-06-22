'use client'

import {
  buildSecretsComposerCancelUserMessage,
  buildSecretsComposerSuccessUserMessage,
} from '@airo/shared'
import { useQueryClient } from '@tanstack/react-query'
import Growl from '@ux/growl'

import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import { useChatContext } from '@/contexts/ChatContext'
import { useSecretOperations } from '@/hooks/useSecretOperations'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import {
  useCurrentAppId,
  useStreamingConversationStore,
  useStreamingState,
} from '@/stores/useStreamingConversationStore'

interface SecretOperation {
  name: string
  value: string
  isExisting?: boolean
}

function buildOperations(secrets: SecretOperation[]): {
  additions?: Array<{ name: string; value: string }>
  updates?: Array<{ name: string; value: string }>
} {
  const additions: Array<{ name: string; value: string }> = []
  const updates: Array<{ name: string; value: string }> = []

  for (const secret of secrets) {
    const name = secret.name.trim()
    const value = secret.value.trim()
    if (!name || !value) {
      continue
    }

    if (secret.isExisting) {
      updates.push({ name, value })
    } else {
      additions.push({ name, value })
    }
  }

  return {
    additions: additions.length > 0 ? additions : undefined,
    updates: updates.length > 0 ? updates : undefined,
  }
}

export function useSecretsRequestActions(
  request: ActiveSecretsRequest | null,
  conversationId?: string,
) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const currentAppId = useCurrentAppId()
  const { sendMessage } = useChatContext()
  const secretOperations = useSecretOperations()
  const resolveSecretsComposerToolCall = useStreamingConversationStore(
    (state) => state.resolveSecretsComposerToolCall,
  )
  const cancelSecretsComposerToolCall = useStreamingConversationStore(
    (state) => state.cancelSecretsComposerToolCall,
  )
  const streamingState = useStreamingState()
  const isAssistantStreamActive = streamingState !== 'idle'

  function queueComposerContinuation(content: string, toolCallId: string) {
    queueMicrotask(() => {
      void (async function deliverComposerContinuation() {
        try {
          await sendMessage({ content })
        } catch (error) {
          logger.error('secrets.panel.messageDeliveryFailed', {
            conversationId,
            appId: currentAppId,
            toolCallId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    })
  }

  async function persist(toolCallId: string, secrets: SecretOperation[]): Promise<string[]> {
    if (!currentAppId) {
      throw new Error('No app selected')
    }

    const operations = buildOperations(secrets)
    if (!operations.additions?.length && !operations.updates?.length) {
      throw new Error('No secret value to save')
    }

    const persistedNames = [
      ...(operations.additions ?? []),
      ...(operations.updates ?? []),
    ].map((secret) => secret.name)

    logger.info('secrets.panel.submitting', {
      conversationId,
      appId: currentAppId,
      toolCallId,
      hasAdditions: Boolean(operations.additions?.length),
      hasUpdates: Boolean(operations.updates?.length),
    })

    try {
      await secretOperations.mutateAsync({
        appId: currentAppId,
        variant: 'preview',
        operations,
      })
    } catch (error) {
      logger.error('secrets.panel.error', {
        conversationId,
        appId: currentAppId,
        toolCallId,
        error: error instanceof Error ? error.message : String(error),
      })

      Growl.addGrowlMessage({
        id: `secrets-panel-error-${toolCallId}`,
        title: t('builder_status_failed'),
        children:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : t('builder_settings_secrets_error_saving_description'),
        emphasis: 'critical',
      })

      throw error
    }

    return persistedNames
  }

  async function submitOne(trimmedValue: string) {
    if (!request || isAssistantStreamActive) {
      return
    }

    const secret = request.payload.secrets[0]
    const persistedNames = await persist(request.toolCallId, [
      {
        name: secret.name,
        value: trimmedValue,
        isExisting: secret.isExisting,
      },
    ])

    resolveSecretsComposerToolCall(request.secretKey)

    if (currentAppId) {
      void queryClient.invalidateQueries({ queryKey: ['next-actions', currentAppId] })
    }

    queueComposerContinuation(
      buildSecretsComposerSuccessUserMessage(
        request.payload.mode === 'update' ? 'update' : 'add',
        persistedNames,
      ),
      request.toolCallId,
    )
  }

  async function submitMulti(values: Record<string, string>) {
    if (!request || isAssistantStreamActive) {
      return
    }

    const secrets = request.payload.secrets.map((secret) => ({
      name: secret.name,
      value: values[secret.name] ?? '',
      isExisting: secret.isExisting,
    }))

    const persistedNames = await persist(request.toolCallId, secrets)

    resolveSecretsComposerToolCall(request.secretKey)

    if (currentAppId) {
      void queryClient.invalidateQueries({ queryKey: ['next-actions', currentAppId] })
    }

    queueComposerContinuation(
      buildSecretsComposerSuccessUserMessage(
        request.payload.mode === 'update' ? 'update' : 'add',
        persistedNames,
      ),
      request.toolCallId,
    )
  }

  function cancel() {
    if (!request || secretOperations.isPending) {
      return
    }

    logger.info('secrets.panel.cancelled', {
      conversationId,
      appId: currentAppId,
      toolCallId: request.toolCallId,
      totalSecrets: request.allSecretNames.length,
    })

    cancelSecretsComposerToolCall(request.toolCallId, request.allSecretNames)

    if (currentAppId) {
      void queryClient.invalidateQueries({ queryKey: ['next-actions', currentAppId] })
    }

    queueComposerContinuation(buildSecretsComposerCancelUserMessage(), request.toolCallId)
  }

  return {
    cancel,
    isPending: secretOperations.isPending || isAssistantStreamActive,
    isClosePending: secretOperations.isPending,
    submitMulti,
    submitOne,
  }
}
