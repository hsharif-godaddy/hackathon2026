import { describe, expect, it } from 'vitest'

import {
  buildApplyKey,
  buildUpdatedPost,
  parseRawContent,
} from '@/app/[market]/develop/components/tool-renderers/SocialPostEditToolRenderer'

describe('SocialPostEditToolRenderer helpers', () => {
  it('parses raw content from JSON string', () => {
    const result = parseRawContent('{"message":"New copy","hashtags":["a","b"],"callToAction":"Shop now"}')

    expect(result).toEqual({
      message: 'New copy',
      hashtags: ['a', 'b'],
      callToAction: 'Shop now',
    })
  })

  it('returns empty object for invalid raw string', () => {
    expect(parseRawContent('not-json')).toEqual({})
  })

  it('builds updated post fields from raw content', () => {
    const updated = buildUpdatedPost(
      {
        id: 'post-1',
        campaignContentId: 'cont-1',
        styleLabel: 'Social Post',
        content: 'Old copy',
        hashtags: ['old'],
      },
      {
        message: 'New copy',
        hashtags: ['new'],
        callToAction: 'Learn more',
      },
    )

    expect(updated.content).toBe('New copy')
    expect(updated.hashtags).toEqual(['new'])
    expect(updated.callToAction).toBe('Learn more')
  })

  it('generates different apply keys for different edits', () => {
    const first = buildApplyKey({
      post: {
        id: 'cont-1',
        rawContent: { message: 'first edit' },
      },
    })
    const second = buildApplyKey({
      post: {
        id: 'cont-1',
        rawContent: { message: 'second edit' },
      },
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toEqual(second)
  })

})
