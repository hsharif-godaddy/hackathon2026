import { useMemo } from 'react'

import { pickLatestUnresolvedFromToolCalls } from '@/app/[market]/develop/components/chat/secrets/resolveSecretsRequest'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import {
  type ChatMessage,
  useActiveStream,
  useMessages,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'

function findUnresolvedInMessages(
  messages: ChatMessage[],
  resolvedSecrets: Record<string, true>,
): ActiveSecretsRequest | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue
    }

    const found = pickLatestUnresolvedFromToolCalls(message.toolCalls, resolvedSecrets)
    if (found) {
      return found
    }
  }

  return null
}

export function useActiveSecretsRequest(): ActiveSecretsRequest | null {
  const messages = useMessages()
  const activeStream = useActiveStream()
  const resolvedSecretsComposerToolCallIds = useStreamingConversationStore(
    (state) => state.resolvedSecretsComposerToolCallIds,
  )

  return useMemo(() => {
    // Prefer the in-flight stream so takeover mounts as soon as requestSecrets completes.
    if (activeStream?.toolCalls?.length) {
      const streamRequest = pickLatestUnresolvedFromToolCalls(
        activeStream.toolCalls,
        resolvedSecretsComposerToolCallIds,
      )
      if (streamRequest) {
        return streamRequest
      }
    }

    // Unresolved requestSecrets stays active until save/cancel — including while a
    // later user message is streaming — so the composer is not replaced by ChatInput.
    return findUnresolvedInMessages(messages, resolvedSecretsComposerToolCallIds)
  }, [activeStream, messages, resolvedSecretsComposerToolCallIds])
}
