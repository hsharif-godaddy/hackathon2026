import { isValidElement, ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { PhoneLink } from '@/app/[market]/develop/components/preview/inbox/PhoneLink'
import { formatMessageText } from '@/lib/inbox/format/message'

const anchorHrefs = (nodes: (string | ReactElement)[]): string[] =>
  nodes
    .filter((node): node is ReactElement => isValidElement(node))
    .flatMap((fragment) => {
      const child = (fragment.props as { children?: unknown }).children
      const anchor = Array.isArray(child) ? child.find(isValidElement) : child
      return isValidElement(anchor) ? [String((anchor.props as { href?: string }).href)] : []
    })

const phoneLinkPhones = (nodes: (string | ReactElement)[]): string[] =>
  nodes
    .filter((node): node is ReactElement => isValidElement(node))
    .flatMap((fragment) => {
      const child = (fragment.props as { children?: unknown }).children
      return isValidElement(child) && child.type === PhoneLink
        ? [String((child.props as { phone?: string }).phone)]
        : []
    })

describe('formatMessageText', () => {
  it('preserves a url as an anchor through the full pipeline', () => {
    const result = formatMessageText('check https://example.com now')
    expect(anchorHrefs(result)).toContain('https://example.com')
  })

  it('preserves an email anchor through the full pipeline', () => {
    const result = formatMessageText('mail me at a@b.com please')
    expect(anchorHrefs(result)).toContain('mailto:a@b.com')
  })

  it('renders a valid phone number as a PhoneLink', () => {
    const result = formatMessageText('call 480-555-1234 today')
    expect(phoneLinkPhones(result)).toContain('+14805551234')
  })

  it('leaves an invalid phone number (exchange starting 0) as plain text', () => {
    const result = formatMessageText('ref 480-055-1234 here')
    expect(phoneLinkPhones(result)).toHaveLength(0)
  })

  it('does not link a phone-length run embedded in a longer digit string', () => {
    // The no-lookbehind boundary `(?:^|\D)` must keep the original lookbehind guarantee:
    // a 10-digit run inside a longer all-digit string is never matched mid-run.
    const result = formatMessageText('order 5551234567890123 shipped')
    expect(phoneLinkPhones(result)).toHaveLength(0)
  })

  it('preserves the words around a phone number after the boundary rewrite', () => {
    // The number (and the separator the matcher absorbs ahead of it — unchanged from the
    // original lookbehind regex) becomes the link; the surrounding words stay intact.
    const result = formatMessageText('call 480-555-1234 today')
    expect(phoneLinkPhones(result)).toContain('+14805551234')
    expect(result.filter((node): node is string => typeof node === 'string').join('')).toBe('call today')
  })
})
