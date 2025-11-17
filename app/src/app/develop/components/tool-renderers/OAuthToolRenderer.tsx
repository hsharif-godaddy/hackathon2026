'use client'

import React from 'react'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import DefaultToolRenderer from './DefaultToolRenderer'
import ChatAuthRequestMessage from '../ChatAuthRequestMessage'

/**
 * Custom renderer for oauthAccessToken tool
 * Shows inline authentication button when auth is required
 * Success/error feedback is handled by the popup window
 */
export default function OAuthToolRenderer({ toolStatus, result, ...rest }: DefaultToolRendererProps) {
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as any
    
    // Render inline auth UI if auth is required
    if (r.authRequired && r.authRequest && r.authRequest.redirectUrl && r.authRequest.state) {
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
