import { describe, expect, it } from 'vitest'

import { cleanCapturedText } from './cleanCapturedText'

// Real noisy example from the task description
const NOISY_EXAMPLE =
  '0 Skip to Content Home About Services Gallery Schedule estimates Contact Schedule an estimate Open Menu Close Menu Open Menu Close Menu Home About Services Gallery Schedule estimates Contact Schedule an estimate Gallery of our projects Kitchen Remodels Bathroom Remodels … Jayhawk Construction Licensed and Bonded in Washington state'

describe('cleanCapturedText', () => {
  it('removes leading skip-to-content boilerplate', () => {
    const result = cleanCapturedText(NOISY_EXAMPLE)
    expect(result).not.toMatch(/^0\s/)
    expect(result).not.toMatch(/Skip to Content/)
  })

  it('removes Open Menu / Close Menu toggle phrases', () => {
    const result = cleanCapturedText(NOISY_EXAMPLE)
    expect(result).not.toContain('Open Menu')
    expect(result).not.toContain('Close Menu')
  })

  it('collapses repeated nav sequences to one occurrence', () => {
    // The nav "Home About Services Gallery … Contact …" appears 2-3× — only one should survive
    const result = cleanCapturedText(NOISY_EXAMPLE)
    const navWord = 'Services'
    const firstIdx = result.indexOf(navWord)
    const secondIdx = result.indexOf(navWord, firstIdx + navWord.length)
    // Should not appear twice (the nav phrase was repeated)
    expect(secondIdx).toBe(-1)
  })

  it('preserves unique body content', () => {
    const result = cleanCapturedText(NOISY_EXAMPLE)
    expect(result).toContain('Gallery of our projects')
    expect(result).toContain('Kitchen Remodels')
    expect(result).toContain('Bathroom Remodels')
    expect(result).toContain('Jayhawk Construction')
    expect(result).toContain('Licensed and Bonded in Washington state')
  })

  it('normalizes multiple consecutive spaces/newlines to single spaces', () => {
    const input = 'Hello   world\n\n\nFoo   Bar'
    const result = cleanCapturedText(input)
    expect(result).toBe('Hello world Foo Bar')
  })

  it('is idempotent — cleaning twice equals cleaning once', () => {
    const once = cleanCapturedText(NOISY_EXAMPLE)
    const twice = cleanCapturedText(once)
    expect(twice).toBe(once)
  })

  it('leaves already-clean text unchanged (modulo normalization)', () => {
    const clean = 'This is clean content about our services and products.'
    expect(cleanCapturedText(clean)).toBe(clean)
  })

  it('handles empty string', () => {
    expect(cleanCapturedText('')).toBe('')
  })

  it('handles text that is only boilerplate', () => {
    const onlyBoilerplate = '0 Skip to Content Open Menu Close Menu Open Menu Close Menu'
    // Should return empty string or a clean empty after normalization
    const result = cleanCapturedText(onlyBoilerplate)
    expect(result).not.toContain('Skip to Content')
    expect(result).not.toContain('Open Menu')
    expect(result.trim()).toBe('')
  })

  it('handles leading numeric token without Skip to Content', () => {
    const input = '0 Home About Services'
    const result = cleanCapturedText(input)
    expect(result).not.toMatch(/^0\s/)
    expect(result).toContain('Home')
  })

  it('completes quickly on a large, repeat-heavy input (bounded complexity)', () => {
    // Worst case for the old unbounded scan: many distinct tokens with no
    // collapsible runs forces it to try every run length at every position
    // (O(n^3)). Build ~8k unique tokens and assert it returns well under a
    // generous budget — the unbounded version took seconds-to-minutes here.
    const tokens: string[] = []
    for (let i = 0; i < 8000; i++) tokens.push(`tok${i}`)
    const input = tokens.join(' ')

    const start = performance.now()
    const result = cleanCapturedText(input)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
    expect(result.length).toBeGreaterThan(0)
  })

  it('truncates input beyond the token cap (display-only)', () => {
    // 20k unique tokens → output is capped, not the full input.
    const tokens: string[] = []
    for (let i = 0; i < 20000; i++) tokens.push(`w${i}`)
    const result = cleanCapturedText(tokens.join(' '))
    const outTokenCount = result.split(' ').filter(Boolean).length
    expect(outTokenCount).toBeLessThanOrEqual(5000)
  })

  it('still collapses repeated nav blocks longer than the old min but within the window', () => {
    const nav = Array.from({ length: 20 }, (_, i) => `nav${i}`).join(' ')
    const result = cleanCapturedText(`${nav} ${nav} body content here`)
    // The 20-token nav block repeats once — only one copy should survive.
    expect(result.indexOf('nav0')).toBe(result.lastIndexOf('nav0'))
    expect(result).toContain('body content here')
  })
})
