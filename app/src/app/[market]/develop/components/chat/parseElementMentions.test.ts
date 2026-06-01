import { describe, expect, it } from 'vitest'

import { parseElementMentions } from '@/app/[market]/develop/components/chat/parseElementMentions'

describe('parseElementMentions', function parseElementMentionsTests() {
  it('returns empty mentions and original text when there are no mentions', function noMentions() {
    const { mentions, text } = parseElementMentions('make this red')
    expect(mentions).toHaveLength(0)
    expect(text).toBe('make this red')
  })

  it('preserves newlines in plain messages with no mentions', function preservesNewlines() {
    const { mentions, text } = parseElementMentions('Hello\nWorld')
    expect(mentions).toHaveLength(0)
    expect(text).toBe('Hello\nWorld')
  })

  it('extracts a single known tag into a mention and removes it from text', function singleKnownTag() {
    const { mentions, text } = parseElementMentions('#1 <button> make this rounded')
    expect(mentions).toHaveLength(1)
    expect(mentions[0]?.tag).toBe('button')
    expect(text).toBe('make this rounded')
  })

  it('extracts multiple mentions and collapses whitespace in remaining text', function multipleMentions() {
    const { mentions, text } = parseElementMentions('#1 <p> make this green #2 <button> and bold')
    expect(mentions).toHaveLength(2)
    expect(mentions[0]?.tag).toBe('p')
    expect(mentions[1]?.tag).toBe('button')
    expect(text).toBe('make this green and bold')
  })

  it('does not leave double spaces when a mention is mid-sentence', function midSentenceWhitespace() {
    const { mentions, text } = parseElementMentions('Make #1 <button> rounded')
    expect(mentions).toHaveLength(1)
    expect(text).toBe('Make rounded')
  })

  it('falls back to the raw tag name when the tag is unknown', function unknownTagFallback() {
    const { mentions, text } = parseElementMentions('#1 <article> test')
    expect(mentions).toHaveLength(1)
    expect(mentions[0]?.tag).toBe('article')
    expect(text).toBe('test')
  })

  it('extracts interleaved composer text with multiple element selections', function interleavedComposer() {
    const { mentions, text } = parseElementMentions(
      'change this to red #1 <h1> and change this to black #2 <p>',
    )
    expect(mentions).toHaveLength(2)
    expect(mentions[0]?.tag).toBe('h1')
    expect(mentions[1]?.tag).toBe('p')
    expect(text).toBe('change this to red and change this to black')
  })
})
