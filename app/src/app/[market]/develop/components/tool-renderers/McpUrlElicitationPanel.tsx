'use client'

import { type ReactNode, useMemo } from 'react'
import Button from '@ux/button'

export interface ParsedMcpElicitationUrl {
  host: string
  valid: boolean
  allowed: boolean
  suspicious: boolean
  reason?: 'non_https' | 'invalid_url'
}

export function parseMcpElicitationUrl(url: string): ParsedMcpElicitationUrl {
  try {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const hasSpoofingRisk = parsedUrl.hostname.includes('xn--')

    return {
      host: parsedUrl.host,
      valid: true,
      allowed: isHttps,
      suspicious: hasSpoofingRisk,
      ...(isHttps ? {} : { reason: 'non_https' as const }),
    }
  } catch {
    return {
      host: url,
      valid: false,
      allowed: false,
      suspicious: true,
      reason: 'invalid_url',
    }
  }
}

interface McpUrlElicitationPanelProps {
  message: string
  url: string
  awaitingCompletion: boolean
  disabled: boolean
  openLabel: string
  retryLabel: string
  cancelLabel: string
  openHostLabel: string
  completionMessage: string
  suspiciousUrlLabel: string
  httpsOnlyLabel: string
  invalidUrlLabel: string
  onAccept: () => void
  onCancel: () => void
}

export default function McpUrlElicitationPanel({
  message,
  url,
  awaitingCompletion,
  disabled,
  openLabel,
  retryLabel,
  cancelLabel,
  openHostLabel,
  completionMessage,
  suspiciousUrlLabel,
  httpsOnlyLabel,
  invalidUrlLabel,
  onAccept,
  onCancel,
}: McpUrlElicitationPanelProps): ReactNode {
  const parsed = useMemo(() => parseMcpElicitationUrl(url), [url])
  const reasonLabel = parsed.reason === 'non_https'
    ? httpsOnlyLabel
    : parsed.reason === 'invalid_url'
      ? invalidUrlLabel
      : null

  function handleOpen(): void {
    if (disabled || !parsed.allowed) return
    window.open(url, '_blank', 'noopener,noreferrer')
    onAccept()
  }

  return (
    <div className="w-full text-sm">
      {message ? <div className="px-1 pb-1 text-sm font-medium text-foreground">{message}</div> : null}

      {awaitingCompletion ? (
        <div className="px-1 pb-2 text-xs text-muted-foreground">{completionMessage}</div>
      ) : null}

      <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
        <span className="text-xs text-muted-foreground">{openHostLabel}</span>
        <span className="truncate text-sm font-medium text-foreground" title={url}>
          {parsed.host}
        </span>
        <span className="truncate text-xs text-muted-foreground/70" title={url}>
          {url}
        </span>
        {parsed.suspicious ? (
          <span className="text-xs text-destructive">{suspiciousUrlLabel}</span>
        ) : null}
        {reasonLabel ? <span className="text-xs text-destructive">{reasonLabel}</span> : null}
      </div>

      <div className="mt-2 flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button type="button" design="control" size="sm" text={cancelLabel} disabled={disabled} onClick={onCancel} />
        {awaitingCompletion ? (
          <Button type="button" design="primary" size="sm" text={retryLabel} disabled={disabled} onClick={onAccept} />
        ) : (
          <Button
            type="button"
            design="primary"
            size="sm"
            text={openLabel}
            disabled={disabled || !parsed.allowed}
            onClick={handleOpen}
          />
        )}
      </div>
    </div>
  )
}
