'use client'

import React from 'react'

import ChatSecretsRequestMessage from '@/app/develop/components/ChatSecretsRequestMessage'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import { useIsActivelyStreaming } from '@/stores/useStreamingConversationStore'

/**
 * Custom renderer for requestSecrets tool
 * Shows inline secrets form when secrets are required
 *
 * Waits for agent to finish streaming before showing the form
 * to ensure the user sees the complete context before interacting
 */
export default function SecretsToolRenderer({ toolStatus, result, isLastAssistantMessage, ...rest }: DefaultToolRendererProps) {
  const isStreaming = useIsActivelyStreaming()

  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as any

    // Render inline secrets form if secrets are required
    if (r.secretsRequired && r.secretsRequest) {
      return (
        <div className="-my-1">
          <ChatSecretsRequestMessage
            payload={r.secretsRequest}
            isInteractive={isLastAssistantMessage && !isStreaming}
          />
        </div>
      )
    }

    // Success without secrets required: don't show anything (agent will proceed)
    if (r.success && !r.secretsRequired) {
      return null
    }
  }

  return <DefaultToolRenderer toolStatus={toolStatus} result={result} {...rest} />
}
