import { describe, expect, it } from 'vitest'

import { thumbUrl } from './thumbUrl'

describe('thumbUrl', () => {
  it('downsizes Squarespace format=original to a small variant', () => {
    const out = thumbUrl('https://images.squarespace-cdn.com/x/y.jpg?format=original')
    expect(out).toContain('format=300w')
    expect(out).not.toContain('format=original')
  })

  it('downsizes sqsp.net format=original', () => {
    const out = thumbUrl('https://static1.sqsp.net/x.jpg?format=original')
    expect(out).toContain('format=300w')
  })

  it('downsizes Wix fill dimensions in the path', () => {
    const out = thumbUrl(
      'https://static.wixstatic.com/media/abc~mv2.jpg/v1/fill/w_1920,h_2560,al_c,q_90/abc.jpg'
    )
    expect(out).toMatch(/w_300/)
    expect(out).toMatch(/h_300/)
    expect(out).not.toContain('w_1920')
    expect(out).not.toContain('h_2560')
  })

  it('caps an oversized generic width query param (lower only)', () => {
    expect(thumbUrl('https://cdn.example.com/i.jpg?w=2000')).toContain('w=300')
    expect(thumbUrl('https://cdn.example.com/i.jpg?width=1600')).toContain('width=300')
  })

  it('leaves a small width param unchanged (never upscales)', () => {
    expect(thumbUrl('https://cdn.example.com/i.jpg?w=120')).toContain('w=120')
  })

  it('leaves unknown URLs without recognised size hints unchanged', () => {
    const url = 'https://cdn.example.com/image.png'
    expect(thumbUrl(url)).toBe(url)
  })

  it('returns the input unchanged when not a valid URL', () => {
    expect(thumbUrl('not a url')).toBe('not a url')
  })
})
