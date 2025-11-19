'use client'

import { useState, useEffect } from 'react'
import Button from '@ux/button'
import { openOAuthPopupAndAwait } from '@/lib/oauth-popup'
import { logger } from '@/lib/request-context'
import { useCurrentAppId } from '@/stores/useStreamingConversationStore'
import { getSharedSocket } from '@/lib/socketRegistry'
import { useStreamingWebSocket } from '@/hooks/useStreamingWebSocket'

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
    const { sendMessage } = useStreamingWebSocket()

    const { title, description, scopes, redirectUrl, state, provider } = payload

    /**
     * Listen for OAuth completion events via WebSocket
     * When OAuth succeeds, automatically notify agent to continue
     */
    useEffect(() => {
        const socket = getSharedSocket()
        if (!socket) return

        const handleOAuthResult = (data: any) => {
            // Check if this OAuth result matches our state
            if (data.state !== state) return
            if (data.appId !== currentAppId) return

            if (data.success) {
                logger.info('oauth.auth_request.completed', {
                    conversationId,
                    state,
                    provider: data.provider
                })

                setStatus('success')

                // Automatically notify agent to continue
                setTimeout(() => {
                    sendMessage('OAuth authentication completed successfully. Please continue.')
                }, 500)
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

        socket.on('oauth:result', handleOAuthResult)

        return () => {
            socket.off('oauth:result', handleOAuthResult)
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
            openOAuthPopupAndAwait(redirectUrl, state, currentAppId)
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
        <div className="max-w-2xl mx-auto my-4">
            <div className="rounded-lg border border-intents-ux-warning-borderColor bg-intents-ux-warning-backgroundColor p-4">
                {/* Header */}
                <div className="flex items-start gap-3 mb-3">
                    <div className="text-2xl">🔐</div>
                    <div className="flex-1">
                        <h3 className="text-base font-semibold text-typography-highEmphasis mb-1">
                            {title || 'Authentication Required'}
                        </h3>
                        <p className="text-sm text-typography-mediumEmphasis">
                            {description || 'This action requires GoDaddy OAuth permission for:'}
                        </p>
                    </div>
                </div>

                {/* Scopes List */}
                <div className="ml-11 mb-4">
                    <ul className="text-sm text-typography-mediumEmphasis space-y-1">
                        {scopes.map((scope) => (
                            <li key={scope} className="flex items-center gap-2">
                                <span className="text-intents-ux-warning-borderColor">•</span>
                                <code className="px-1.5 py-0.5 rounded bg-surfaces-boxLowContrast text-xs">
                                    {scope}
                                </code>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Action Button */}
                <div className="ml-11 flex items-center gap-3">
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
                        <div className="flex items-center gap-2 text-sm text-typography-mediumEmphasis">
                            <span>Please continue authenticating in the popup window...</span>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex items-center gap-2 text-sm text-intents-ux-success-textColor">
                            <span className="text-lg">✓</span>
                            <span className="font-medium">Authentication successful</span>
                        </div>
                    )}

                    {status === 'failed' && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-intents-ux-error-textColor">
                                <span className="text-lg">✕</span>
                                <span className="font-medium">Authentication failed</span>
                            </div>
                            {error && (
                                <p className="text-xs text-typography-mediumEmphasis ml-6">{error}</p>
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
                    <p className="ml-11 mt-3 text-xs text-typography-lowEmphasis">
                        A popup window will open for secure authentication with {provider === 'godaddy' ? 'GoDaddy' : provider}
                    </p>
                )}
            </div>
        </div>
    )
}
