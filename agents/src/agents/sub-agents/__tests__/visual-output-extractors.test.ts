import { describe, it, expect } from 'vitest'
import { mediaExtractor, pageExtractor, docExtractor } from '../visual-output-extractors.js'

describe('mediaExtractor', () => {
  it('returns null for non-media tools', () => {
    expect(mediaExtractor('readFile', {}, {})).toBeNull()
  })

  it('returns null when result is not successful', () => {
    expect(mediaExtractor('media', {}, { success: false, slot: 'hero' })).toBeNull()
  })

  it('returns null when slot is missing', () => {
    expect(mediaExtractor('media', {}, { success: true })).toBeNull()
  })

  it('extracts media output from object result', () => {
    const result = { success: true, slot: 'hero-image', slotUrl: '/img/hero.jpg', resolvedUrl: 'https://cdn.example.com/hero.jpg' }
    expect(mediaExtractor('media', {}, result)).toEqual({
      type: 'media',
      label: 'hero-image',
      url: '/img/hero.jpg',
      thumbnailUrl: 'https://cdn.example.com/hero.jpg',
    })
  })

  it('extracts media output from JSON string result', () => {
    const result = JSON.stringify({ success: true, slot: 'logo', slotUrl: '/img/logo.png', resolvedUrl: 'https://cdn.example.com/logo.png' })
    expect(mediaExtractor('media', {}, result)).toEqual({
      type: 'media',
      label: 'logo',
      url: '/img/logo.png',
      thumbnailUrl: 'https://cdn.example.com/logo.png',
    })
  })

  it('returns null for invalid JSON string', () => {
    expect(mediaExtractor('media', {}, 'not json')).toBeNull()
  })
})

describe('pageExtractor', () => {
  it('returns null for non-edit tools', () => {
    expect(pageExtractor('readFile', { path: 'src/pages/Home.tsx' }, {})).toBeNull()
  })

  it('returns null when path is missing', () => {
    expect(pageExtractor('str_replace_based_edit_tool', {}, {})).toBeNull()
  })

  it('returns null for non-page paths', () => {
    expect(pageExtractor('str_replace_based_edit_tool', { path: 'src/components/Header.tsx' }, {})).toBeNull()
  })

  it('extracts route from src/pages/Home.tsx', () => {
    expect(pageExtractor('str_replace_based_edit_tool', { path: 'src/pages/Home.tsx' }, {})).toEqual({
      type: 'page',
      label: '/',
      url: '/',
    })
  })

  it('extracts route from src/pages/About.tsx', () => {
    expect(pageExtractor('str_replace_based_edit_tool', { path: 'src/pages/About.tsx' }, {})).toEqual({
      type: 'page',
      label: '/about',
      url: '/about',
    })
  })

  it('extracts route from src/pages/Contact.tsx', () => {
    expect(pageExtractor('str_replace_based_edit_tool', { path: 'src/pages/Contact.tsx' }, {})).toEqual({
      type: 'page',
      label: '/contact',
      url: '/contact',
    })
  })

  it('handles nested page paths', () => {
    expect(pageExtractor('str_replace_based_edit_tool', { path: 'src/pages/blog/Post.tsx' }, {})).toEqual({
      type: 'page',
      label: '/blog/post',
      url: '/blog/post',
    })
  })
})

describe('docExtractor', () => {
  it('returns null for non-showDoc tools', () => {
    expect(docExtractor('readFile', { path: 'docs/brief.md' }, {})).toBeNull()
  })

  it('returns null when path is missing', () => {
    expect(docExtractor('showDoc', {}, {})).toBeNull()
  })

  it('extracts doc output', () => {
    expect(docExtractor('showDoc', { path: 'design-preview' }, {})).toEqual({
      type: 'doc',
      label: 'design-preview',
      url: 'design-preview',
    })
  })
})
