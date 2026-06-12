'use client'

import React from 'react'

import { isSecretsPanelEligible } from '@/app/[market]/develop/components/chat/secrets/isSecretsPanelEligible'
import ChatSecretsRequestMessage from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { parseSecretsRequestFromToolResult } from '@/app/[market]/develop/components/utils/parseSecretsRequestFromToolResult'
import { SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useIsActivelyStreaming } from '@/stores/useStreamingConversationStore'

/**
 * Renders requestSecrets tool calls.
 *
 * When the airo-builder-secrets-form flag is ON:
 *   - Returns null (UI takeover shows in chat input area instead)
 *
 * When the flag is OFF:
 *   - Renders ChatSecretsRequestMessage inline in the thread
 *   - Current requests are interactive (isInteractive=true)
 *   - Historical requests are disabled (isInteractive=false)
 */
export default function SecretsToolRenderer({ toolStatus, result, isLastAssistantMessage, ...rest }: DefaultToolRendererProps) {
  const isStreaming = useIsActivelyStreaming()
  const isSecretsFormEnabled = useSwitchboard(SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM) === true

  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as { secretsRequired?: unknown; success?: unknown }

    if (r.secretsRequired) {
      const payload = parseSecretsRequestFromToolResult(result, { toolCallId: rest.toolId })
      if (!payload) {
        return <DefaultToolRenderer toolStatus={toolStatus} result={result} {...rest} />
      }

      // When flag is ON: hide inline widget, show takeover in chat input
      if (isSecretsFormEnabled && isSecretsPanelEligible(payload)) {
        return null
      }

      // When flag is OFF: show inline widget in thread
      const isInteractive = Boolean(isLastAssistantMessage && !isStreaming)
      return (
        <div className="-my-1">
          <ChatSecretsRequestMessage
            payload={payload}
            isInteractive={isInteractive}
          />
        </div>
      )
    }

    if (r.success && !r.secretsRequired) {
      return null
    }
  }

  return <DefaultToolRenderer toolStatus={toolStatus} result={result} {...rest} />
}
