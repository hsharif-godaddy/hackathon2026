import { describe, expect, it } from 'vitest'

import { hasComposerAttachments, hasComposerSendPayload } from './composerAttachments'

describe('composerAttachments', () => {
  describe('#hasComposerAttachments', () => {
    it('returns false when all attachment lists are empty or absent', () => {
      expect(hasComposerAttachments({})).toBe(false)
      expect(hasComposerAttachments({
        stagedFiles: [],
        selectedAssets: [],
        referencedFiles: [],
      })).toBe(false)
    })

    it('returns true when staged files are present', () => {
      expect(hasComposerAttachments({ stagedFiles: [{ id: '1' }] })).toBe(true)
    })

    it('returns true when selected assets are present', () => {
      expect(hasComposerAttachments({ selectedAssets: [{ id: 'a' }] })).toBe(true)
    })

    it('returns true when referenced files are present', () => {
      expect(hasComposerAttachments({ referencedFiles: [{ path: '/a.ts' }] })).toBe(true)
    })
  })

  describe('#hasComposerSendPayload', () => {
    it('returns false when content is empty and there are no attachments', () => {
      expect(hasComposerSendPayload('', {})).toBe(false)
      expect(hasComposerSendPayload('   ', {})).toBe(false)
      expect(hasComposerSendPayload(undefined, {})).toBe(false)
    })

    it('returns true when content has non-whitespace text', () => {
      expect(hasComposerSendPayload('hello', {})).toBe(true)
    })

    it('returns true when attachments exist without text', () => {
      expect(hasComposerSendPayload('', { selectedAssets: [{ id: 'a' }] })).toBe(true)
      expect(hasComposerSendPayload('   ', { stagedFiles: [{ id: '1' }] })).toBe(true)
    })
  })
})
