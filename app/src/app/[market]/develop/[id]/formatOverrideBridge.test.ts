import { describe, expect, it } from 'vitest'

import {
  buildFormatOverrideReplyMessage,
  parseFormatOverrideUpdateData,
  readFormatOverrideCommitId,
} from './formatOverrideBridge'

describe('buildFormatOverrideReplyMessage', () => {
  it('echoes commitId on success', () => {
    expect(buildFormatOverrideReplyMessage('commit-123', { success: true })).toEqual({
      type: 'FORMAT_OVERRIDE_EDIT_SUCCEEDED',
      commitId: 'commit-123',
    })
  })

  it('echoes commitId on failure', () => {
    expect(buildFormatOverrideReplyMessage('commit-123', { success: false, error: 'bad request' })).toEqual({
      type: 'FORMAT_OVERRIDE_EDIT_FAILED',
      commitId: 'commit-123',
      error: 'bad request',
    })
  })
})

describe('parseFormatOverrideUpdateData', () => {
  it('returns normalized data for a valid format override payload', () => {
    expect(parseFormatOverrideUpdateData({
      commitId: 'commit-123',
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true, italic: false, color: null },
    })).toEqual({
      commitId: 'commit-123',
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        contentKey: null,
        contentKeyTemplate: null,
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true, italic: false, color: null },
    })
  })

  it('returns normalized data for content-key targets', () => {
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/content.ts',
        tagName: 'span',
        sourceKind: 'content-key',
        contentKey: 'hero.title',
      },
      marks: { bold: true },
    })).toEqual({
      devId: 'abc123',
      target: {
        file: 'src/content.ts',
        tagName: 'span',
        sourceKind: 'content-key',
        contentKey: 'hero.title',
        contentKeyTemplate: null,
        expressionHash: null,
      },
      marks: { bold: true },
    })
  })

  it('returns normalized data for content-key-template targets', () => {
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/content.ts',
        tagName: 'span',
        sourceKind: 'content-key-template',
        contentKeyTemplate: 'products[].name',
      },
      marks: { color: '#123abc' },
    })).toEqual({
      devId: 'abc123',
      target: {
        file: 'src/content.ts',
        tagName: 'span',
        sourceKind: 'content-key-template',
        contentKey: null,
        contentKeyTemplate: 'products[].name',
        expressionHash: null,
      },
      marks: { color: '#123abc' },
    })
  })

  it('returns null for malformed payloads', () => {
    expect(parseFormatOverrideUpdateData({ devId: 'abc123' })).toBeNull()
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
      },
      marks: { bold: true },
    })).toBeNull()
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'content-key',
      },
      marks: { bold: true },
    })).toBeNull()
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'content-key-template',
      },
      marks: { bold: true },
    })).toBeNull()
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'plain-text',
      },
      marks: { bold: true },
    })).toBeNull()
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: 'true' },
    })).toBeNull()
    expect(parseFormatOverrideUpdateData({
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { underline: true },
    })).toBeNull()
  })
})

describe('readFormatOverrideCommitId', () => {
  it('returns a string commitId from malformed payloads', () => {
    expect(readFormatOverrideCommitId({ commitId: 'commit-123', devId: 123 })).toBe('commit-123')
  })

  it('returns undefined when commitId is missing or invalid', () => {
    expect(readFormatOverrideCommitId({ devId: 'abc123' })).toBeUndefined()
    expect(readFormatOverrideCommitId({ commitId: 123 })).toBeUndefined()
    expect(readFormatOverrideCommitId(null)).toBeUndefined()
  })
})
