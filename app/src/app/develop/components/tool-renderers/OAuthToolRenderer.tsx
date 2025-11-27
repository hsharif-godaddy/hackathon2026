'use client'

import React from 'react'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import DefaultToolRenderer from './DefaultToolRenderer'
import ChatAuthRequestMessage from '../ChatAuthRequestMessage'
import { useIsActivelyStreaming } from '@/stores/useStreamingConversationStore'

/**
 * Custom renderer for oauthAccessToken tool
 * Shows inline authentication button when auth is required
 * Success/error feedback is handled by the popup window
 *
 * IMPORTANT: Only shows the auth button after the agent finishes streaming
 * to prevent users from clicking it too early and missing the completion event
 */
export default function OAuthToolRenderer({ toolStatus, result, ...rest }: DefaultToolRendererProps) {
  const isStreaming = useIsActivelyStreaming()

  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as any

    // Render inline auth UI if auth is required
    // Only show the button if the agent has finished streaming
    if (r.authRequired && r.authRequest && r.authRequest.redirectUrl && r.authRequest.state) {
      // If still streaming, show a loading state instead of the button
      if (isStreaming) {
        return (
          <div className="-my-2">
            <div className="max-w-2xl mx-auto my-4">
              <div className="rounded-lg border border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor p-4">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">🔐</div>
                  <div className="flex-1">
                    <p className="text-sm text-typography-mediumEmphasis">
                      Preparing authentication request...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      }

      return (
        <div className="-my-2">
          <ChatAuthRequestMessage
            payload={r.authRequest}
          />
        </div>
      )
    }

    // Token success: don't show anything (agent will proceed silently)
    if (r.success && !r.authRequired) {
      return null
    }
  }

  return <DefaultToolRenderer toolStatus={toolStatus} result={result} {...rest} />
}
