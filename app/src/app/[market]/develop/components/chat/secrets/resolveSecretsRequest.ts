import { isSecretsPanelEligible } from '@/app/[market]/develop/components/chat/secrets/isSecretsPanelEligible'
import { batchSecretKey, secretKeyFor } from '@/app/[market]/develop/components/chat/secrets/keys'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import { parseSecretsRequestFromToolResult } from '@/app/[market]/develop/components/utils/parseSecretsRequestFromToolResult'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

function extractFromToolCall(
  toolCall: ToolCall,
  resolvedSecrets: Record<string, true>,
): ActiveSecretsRequest | null {
  if (toolCall.name !== 'requestSecrets' || toolCall.status !== 'completed') {
    return null
  }

  const payload = parseSecretsRequestFromToolResult(toolCall.result, { toolCallId: toolCall.id })
  if (!payload || !isSecretsPanelEligible(payload)) {
    return null
  }

  const allSecretNames = payload.secrets.map((secret) => secret.name)

  if (payload.secrets.length === 1) {
    const secretKey = secretKeyFor(toolCall.id, payload.secrets[0].name)
    if (resolvedSecrets[secretKey]) {
      return null
    }

    return {
      payload,
      toolCallId: toolCall.id,
      secretKey,
      allSecretNames,
      displayMode: 'single',
    }
  }

  const batchKey = batchSecretKey(toolCall.id)
  if (resolvedSecrets[batchKey]) {
    return null
  }

  return {
    payload,
    toolCallId: toolCall.id,
    secretKey: batchKey,
    allSecretNames,
    displayMode: 'paginated',
  }
}

export function pickLatestUnresolvedFromToolCalls(
  toolCalls: ToolCall[],
  resolvedSecrets: Record<string, true>,
): ActiveSecretsRequest | null {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const found = extractFromToolCall(toolCalls[index], resolvedSecrets)
    if (found) {
      return found
    }
  }
  return null
}
