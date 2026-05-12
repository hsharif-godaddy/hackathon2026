'use client'

import { useEffect, useState } from 'react'
import Button from '@ux/button'

import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { openOAuthPopupAndAwait } from '@/lib/oauth-popup'
import { logger } from '@/lib/request-context'
import { useCurrentAppId } from '@/stores/useStreamingConversationStore'

/**
 * Auth request message payload from agents service
 */
export interface AuthRequestPayload {
    type: 'auth_request'
    provider: 'godaddy'
    scopes: string[]
    redirectUrl: string
    state: string
    title?: string
    description?: string
}

interface ChatAuthRequestMessageProps {
    payload: AuthRequestPayload
    conversationId?: string
}

/**
 * Inline chat message for OAuth authentication requests
 *
 * Displays when an agent action requires OAuth authentication.
 * Shows requested scopes and provides "Authenticate" button that
 * opens OAuth popup flow.
 */
export default function ChatAuthRequestMessage({
    payload,
    conversationId
}: ChatAuthRequestMessageProps) {
    const [status, setStatus] = useState<'pending' | 'authenticating' | 'success' | 'failed'>('pending')
    const [error, setError] = useState<string | null>(null)
    const currentAppId = useCurrentAppId()
    const { sendMessage } = useWebSocketContext()

    const { title, description, redirectUrl, state, provider } = payload

    /**
     * Listen for OAuth completion via transport-agnostic window CustomEvent
     * (dispatched by both TransportSupervisor for WS and SSETransport for SSE).
     * When OAuth succeeds, automatically notify agent to continue.
     */
    useEffect(() => {
        if (typeof window === 'undefined') return

        const handleOAuthResult = (event: Event) => {
            const data = (event as CustomEvent).detail as {
                state?: string
                appId?: string
                success?: boolean
                provider?: string
                error?: string
                description?: string
            }
            if (!data || data.state !== state) return
            if (data.appId !== currentAppId) return

            if (data.success) {
                logger.info('oauth.auth_request.completed', {
                    conversationId,
                    state,
                    provider: data.provider
                })

                setStatus('success')

                // Notify agent in a microtask to avoid background-tab rAF throttling.
                if (typeof queueMicrotask === 'function') {
                  queueMicrotask(() => {
                    void sendMessage({ content: 'OAuth authentication completed successfully. Please continue.' })
                  })
                } else {
                  void Promise.resolve().then(() => sendMessage({ content: 'OAuth authentication completed successfully. Please continue.' }))
                }
            } else {
                logger.error('oauth.auth_request.failed', {
                    conversationId,
                    state,
                    error: data.error,
                    description: data.description
                })

                setStatus('failed')
                setError(data.description || data.error || 'Authentication failed')
            }
        }

        window.addEventListener('oauth:result', handleOAuthResult)

        return () => {
            window.removeEventListener('oauth:result', handleOAuthResult)
        }
    }, [state, currentAppId, conversationId, sendMessage])

    const handleAuthenticate = async () => {
        if (!currentAppId) {
            setError('No app selected')
            setStatus('failed')
            return
        }

        setStatus('authenticating')
        setError(null)

        try {
            openOAuthPopupAndAwait(redirectUrl)
            setStatus('authenticating')
        } catch (err) {
            setStatus('failed')
            const errorMessage = err instanceof Error ? err.message : 'Failed to open authentication popup'
            setError(errorMessage)
            if (conversationId) {
                logger.error('oauth.auth_request.error', {
                    conversationId,
                    state,
                    error: errorMessage
                })
            }
        }
    }

    return (
        <div className="max-w-2xl mx-auto my-2">
            <div className="rounded-lg border border-intents-ux-warning-borderColor bg-intents-ux-warning-backgroundColor p-2">
                {/* Header */}
                <div className="flex items-start gap-1.5 mb-1.5">
                    <div className="text-2xl">🔐</div>
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-typography-highEmphasis mb-0.5">
                            {title || 'Authentication Required'}
                        </h3>
                        <p className="text-sm text-typography-mediumEmphasis">
                            {description || 'This action requires your permission to access your account.'}
                        </p>
                    </div>
                </div>

                {/* Action Button */}
                <div className="ml-5 flex items-center gap-1.5">
                    {status === 'pending' && (
                        <Button
                            design="primary"
                            size="sm"
                            onClick={handleAuthenticate}
                        >
                            Authenticate with {provider === 'godaddy' ? 'GoDaddy' : provider}
                        </Button>
                    )}

                    {status === 'authenticating' && (
                        <div className="flex items-center gap-1 text-sm text-typography-mediumEmphasis">
                            <span>Please continue authenticating in the popup window...</span>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex items-center gap-1 text-sm text-intents-ux-success-textColor">
                            <span className="text-lg">✓</span>
                            <span className="font-medium">Authentication successful</span>
                        </div>
                    )}

                    {status === 'failed' && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-1 text-sm text-intents-ux-error-textColor">
                                <span className="text-lg">✕</span>
                                <span className="font-medium">Authentication failed</span>
                            </div>
                            {error && (
                                <p className="text-xs text-typography-mediumEmphasis ml-3">{error}</p>
                            )}
                            <Button
                                design="secondary"
                                size="sm"
                                onClick={handleAuthenticate}
                            >
                                Try Again
                            </Button>
                        </div>
                    )}
                </div>

                {/* Info Text */}
                {status === 'pending' && (
                    <p className="ml-5 mt-1.5 text-xs text-typography-lowEmphasis">
                        A popup window will open for secure authentication with {provider === 'godaddy' ? 'GoDaddy' : provider}
                    </p>
                )}
            </div>
        </div>
    )
}
