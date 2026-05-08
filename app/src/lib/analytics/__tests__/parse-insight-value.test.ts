import { describe, expect, it } from 'vitest'

import { parseInsightValue } from '../parse-insight-value'

describe('parse-insight-value', () => {
  describe('#parseInsightValue', () => {
    it('parses JSON object with title and detail', () => {
      expect(parseInsightValue('  {"title":" Low bounce ","detail":" More detail here "}  ')).toEqual({
        title: 'Low bounce',
        description: 'More detail here',
      })
    })

    it('parses JSON object with title only', () => {
      expect(parseInsightValue('{"title":"Headline only"}')).toEqual({
        title: 'Headline only',
        description: '',
      })
    })

    it('parses JSON object with detail only', () => {
      expect(parseInsightValue('{"detail":"Body without title"}')).toEqual({
        title: '',
        description: 'Body without title',
      })
    })

    it('falls through when JSON object has no string title or detail', () => {
      const raw = '{"title":1,"detail":false}'
      expect(parseInsightValue(raw)).toEqual({
        title: '',
        description: raw,
      })
    })

    it('falls through when JSON parses but yields empty title and detail strings', () => {
      expect(parseInsightValue('{"title":"","detail":""}')).toEqual({
        title: '',
        description: '{"title":"","detail":""}',
      })
    })

    it('falls through on malformed JSON inside braces', () => {
      const raw = '{not valid json}'
      expect(parseInsightValue(raw)).toEqual({
        title: '',
        description: '{not valid json}',
      })
    })

    it('strips priority bracket prefix before sentence split', () => {
      expect(parseInsightValue('[high] First part. Second part here')).toEqual({
        title: '',
        description: 'First part. Second part here',
      })
    })

    it('strips prefix case-insensitively', () => {
      expect(parseInsightValue('[MeDiUm] Hello. World')).toEqual({
        title: '',
        description: 'Hello. World',
      })
    })

    it('uses whole cleaned string as title when there is no sentence boundary', () => {
      expect(parseInsightValue('No ending punctuation here')).toEqual({
        title: '',
        description: 'No ending punctuation here',
      })
    })

    it('splits on first sentence terminator only', () => {
      expect(parseInsightValue('One. Two. Three! Four?')).toEqual({
        title: '',
        description: 'One. Two. Three! Four?',
      })
    })

    it('does not treat non-object JSON as structured insight', () => {
      expect(parseInsightValue('["just","array"]')).toEqual({
        title: '',
        description: '["just","array"]',
      })
    })
  })
})
