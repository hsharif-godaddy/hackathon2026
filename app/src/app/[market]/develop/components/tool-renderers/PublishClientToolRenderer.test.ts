import { describe, expect, it } from 'vitest'

import { extractCommitHash } from './PublishClientToolRenderer'

describe('extractCommitHash', function extractTests() {
  describe('object result (publishing__publish skill tool)', function objectResult() {
    it('should return commitHash from the result object', function fromObject() {
      const result = {
        success: true,
        message: 'Published commit abcdef1.',
        commitHash: 'abcdef1234567890abcdef1234567890abcdef12',
      }
      expect(extractCommitHash(result, {})).toBe('abcdef1234567890abcdef1234567890abcdef12')
    })

    it('should fall back to input.commitHash when result object has no commitHash', function objectMissingHash() {
      const result = { success: true, message: 'done' }
      expect(extractCommitHash(result, { commitHash: 'fallback123' })).toBe('fallback123')
    })

    it('should return undefined when result object has no commitHash and no input fallback', function objectMissingNoFallback() {
      expect(extractCommitHash({ success: true }, {})).toBeUndefined()
    })

    it('should ignore non-string commitHash on result object', function objectBadType() {
      const result = { commitHash: 12345 as unknown as string }
      expect(extractCommitHash(result, { commitHash: 'inputHash' })).toBe('inputHash')
    })
  })

  describe('string result (legacy publishClient tool)', function stringResult() {
    it('should extract full 40-char SHA from archive path', function archivePath() {
      const result = 'Successfully published commit abcdef1\n\nArchive: /publish/dist/abcdef1234567890abcdef1234567890abcdef12.tar.gz'
      expect(extractCommitHash(result, {})).toBe('abcdef1234567890abcdef1234567890abcdef12')
    })

    it('should prefer archive path SHA over short commit SHA when both are present', function preferArchive() {
      const result = 'Successfully published commit abcdef1\nArchive: /publish/dist/abcdef1234567890abcdef1234567890abcdef12.tar.gz'
      expect(extractCommitHash(result, {})).toBe('abcdef1234567890abcdef1234567890abcdef12')
    })

    it('should extract SHA from legacy "Successfully published commit" message', function legacyMessage() {
      expect(extractCommitHash('Successfully published commit abc1234', {})).toBe('abc1234')
    })

    it('should extract SHA from new "Published commit" message (skill tool)', function skillMessage() {
      expect(extractCommitHash('Published commit abc1234.\nDeployment: dep-1', {})).toBe('abc1234')
    })

    it('should fall back to input.commitHash when string has no matching pattern', function noMatch() {
      expect(extractCommitHash('some unrelated output', { commitHash: 'inputHash' })).toBe('inputHash')
    })
  })

  describe('empty/undefined result', function noResult() {
    it('should return input.commitHash when result is undefined', function undefinedResult() {
      expect(extractCommitHash(undefined, { commitHash: 'inputHash' })).toBe('inputHash')
    })

    it('should return undefined when result is undefined and input has no commitHash', function noneAtAll() {
      expect(extractCommitHash(undefined, {})).toBeUndefined()
    })
  })
})
