/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import McpUrlElicitationPanel, { parseMcpElicitationUrl } from '../McpUrlElicitationPanel'

describe('parseMcpElicitationUrl', () => {
  it('allows HTTPS URLs', () => {
    expect(parseMcpElicitationUrl('https://mcp.example.com/connect')).toEqual(
      expect.objectContaining({
        host: 'mcp.example.com',
        valid: true,
        allowed: true,
      }),
    )
  })

  it('blocks non-HTTPS URLs', () => {
    expect(parseMcpElicitationUrl('http://mcp.example.com/connect')).toEqual(
      expect.objectContaining({
        valid: true,
        allowed: false,
      }),
    )
  })

  it('blocks script-like URL schemes', () => {
    const blockedUrl = 'java' + 'script:alert(1)'
    expect(parseMcpElicitationUrl(blockedUrl)).toEqual(
      expect.objectContaining({
        valid: true,
        allowed: false,
      }),
    )
  })
})

describe('McpUrlElicitationPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('opens an allowed URL only after explicit user action', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onAccept = vi.fn()

    render(
      <McpUrlElicitationPanel
        message="Connect account"
        url="https://mcp.example.com/connect"
        awaitingCompletion={false}
        disabled={false}
        openLabel="Open"
        retryLabel="Retry"
        cancelLabel="Cancel"
        openHostLabel="This opens on:"
        completionMessage="Finish in the browser tab that opened, then choose Retry."
        suspiciousUrlLabel="Double-check this address before continuing."
        httpsOnlyLabel="Only HTTPS links can be opened from this request."
        invalidUrlLabel="This link is not a valid URL."
        onAccept={onAccept}
        onCancel={vi.fn()}
      />,
    )

    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(open).toHaveBeenCalledWith(
      'https://mcp.example.com/connect',
      '_blank',
      'noopener,noreferrer',
    )
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('does not open blocked URL schemes', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onAccept = vi.fn()
    const blockedUrl = 'java' + 'script:alert(1)'

    render(
      <McpUrlElicitationPanel
        message="Connect account"
        url={blockedUrl}
        awaitingCompletion={false}
        disabled={false}
        openLabel="Open"
        retryLabel="Retry"
        cancelLabel="Cancel"
        openHostLabel="This opens on:"
        completionMessage="Finish in the browser tab that opened, then choose Retry."
        suspiciousUrlLabel="Double-check this address before continuing."
        httpsOnlyLabel="Only HTTPS links can be opened from this request."
        invalidUrlLabel="This link is not a valid URL."
        onAccept={onAccept}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(open).not.toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
  })
})
