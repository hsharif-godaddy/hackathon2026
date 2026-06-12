/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'

import { hasMaliciousContent } from './validation'

function toBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function textBuffer(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer
}

const PNG_MAGIC  = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_MAGIC = [0xFF, 0xD8, 0xFF, 0xE0]
const GIF_MAGIC  = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]

describe('hasMaliciousContent', () => {
  describe('image magic bytes', () => {
    it('accepts valid PNG', () => {
      expect(hasMaliciousContent(toBuffer([...PNG_MAGIC, 0x00, 0x00]), 'img.png')).toBe(false)
    })

    it('rejects PNG with wrong magic bytes', () => {
      expect(hasMaliciousContent(toBuffer([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]), 'fake.png')).toBe(true)
    })

    it('rejects PNG with buffer too short', () => {
      expect(hasMaliciousContent(toBuffer([0x89, 0x50]), 'short.png')).toBe(true)
    })

    it('rejects PNG disguised as HTML content', () => {
      expect(hasMaliciousContent(textBuffer('<html><script>alert(1)</script></html>'), 'malicious.png')).toBe(true)
    })

    it('accepts valid JPEG', () => {
      expect(hasMaliciousContent(toBuffer([...JPEG_MAGIC, 0x00, 0x00]), 'photo.jpg')).toBe(false)
    })

    it('accepts valid JPEG with .jpeg extension', () => {
      expect(hasMaliciousContent(toBuffer([...JPEG_MAGIC, 0x00, 0x00]), 'photo.jpeg')).toBe(false)
    })

    it('accepts valid GIF', () => {
      expect(hasMaliciousContent(toBuffer([...GIF_MAGIC, 0x00, 0x00]), 'anim.gif')).toBe(false)
    })

    it('accepts valid WEBP', () => {
      expect(hasMaliciousContent(toBuffer([...WEBP_MAGIC, 0x00, 0x00]), 'img.webp')).toBe(false)
    })

    it('rejects WEBP with RIFF header but wrong sub-format (e.g. WAV)', () => {
      const wav = toBuffer([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
      expect(hasMaliciousContent(wav, 'fake.webp')).toBe(true)
    })
  })

  describe('SVG scanning', () => {
    it('rejects SVG with <script> element', () => {
      const buf = textBuffer('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
      expect(hasMaliciousContent(buf, 'icon.svg')).toBe(true)
    })

    it('rejects SVG with event handler attribute', () => {
      const buf = textBuffer('<svg xmlns="http://www.w3.org/2000/svg"><circle onload="alert(1)" /></svg>')
      expect(hasMaliciousContent(buf, 'icon.svg')).toBe(true)
    })

    it('rejects SVG with javascript: href', () => {
      const buf = textBuffer('<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle /></a></svg>')
      expect(hasMaliciousContent(buf, 'icon.svg')).toBe(true)
    })

    it('accepts clean SVG', () => {
      const buf = textBuffer('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5" fill="red" /></svg>')
      expect(hasMaliciousContent(buf, 'icon.svg')).toBe(false)
    })

    it('accepts malformed SVG (parseerror is not treated as malicious)', () => {
      const buf = textBuffer('not valid svg content at all')
      expect(hasMaliciousContent(buf, 'broken.svg')).toBe(false)
    })

    it('accepts SVG with mismatched XML tags (parse error fast-path)', () => {
      // Mismatched close tag is invalid XML; DOMParser produces a parseerror element
      const buf = textBuffer('<svg xmlns="http://www.w3.org/2000/svg"><circle></svg>')
      expect(hasMaliciousContent(buf, 'broken.svg')).toBe(false)
    })
  })

  describe('HTML scanning', () => {
    it('rejects HTML with <script> tag', () => {
      const buf = textBuffer('<html><body><script>alert(1)</script></body></html>')
      expect(hasMaliciousContent(buf, 'page.html')).toBe(true)
    })

    it('rejects HTML with event handler attribute', () => {
      const buf = textBuffer('<html><body><button onclick="alert(1)">Click</button></body></html>')
      expect(hasMaliciousContent(buf, 'page.html')).toBe(true)
    })

    it('rejects .htm files with inline script', () => {
      const buf = textBuffer('<html><body><script>alert(1)</script></body></html>')
      expect(hasMaliciousContent(buf, 'page.htm')).toBe(true)
    })

    it('accepts clean HTML', () => {
      const buf = textBuffer('<html><body><h1>Hello</h1><p>World</p></body></html>')
      expect(hasMaliciousContent(buf, 'page.html')).toBe(false)
    })
  })

  describe('unchecked file types', () => {
    it('accepts markdown without scanning', () => {
      expect(hasMaliciousContent(textBuffer('# Title\n\n<script>alert(1)</script>'), 'readme.md')).toBe(false)
    })

    it('accepts plain text', () => {
      expect(hasMaliciousContent(textBuffer('plain text content'), 'notes.txt')).toBe(false)
    })

    it('accepts zip by extension (content not scanned)', () => {
      expect(hasMaliciousContent(textBuffer('<script>evil</script>'), 'app.zip')).toBe(false)
    })
  })
})
