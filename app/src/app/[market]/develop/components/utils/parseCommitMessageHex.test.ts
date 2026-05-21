import { describe, expect, it } from 'vitest'

import { parseCommitMessageHex } from './parseCommitMessageHex'

describe('parseCommitMessageHex', function parseCommitMessageHexTests() {
  it('returns plain text when message has no hex', function noHex() {
    expect(parseCommitMessageHex('Update h2 fontSize to text-5xl')).toEqual([
      { type: 'text', value: 'Update h2 fontSize to text-5xl' },
    ])
  })

  it('parses a single 6-digit hex token', function singleHex() {
    expect(parseCommitMessageHex('Update p color to #bcc12f in index.tsx')).toEqual([
      { type: 'text', value: 'Update p color to ' },
      { type: 'hex', value: '#bcc12f', normalized: '#bcc12f' },
      { type: 'text', value: ' in index.tsx' },
    ])
  })

  it('parses multiple hex tokens', function multipleHex() {
    expect(parseCommitMessageHex('Set #abc and #112233')).toEqual([
      { type: 'text', value: 'Set ' },
      { type: 'hex', value: '#abc', normalized: '#aabbcc' },
      { type: 'text', value: ' and ' },
      { type: 'hex', value: '#112233', normalized: '#112233' },
    ])
  })

  it('normalizes 3-digit shorthand hex', function shorthandHex() {
    expect(parseCommitMessageHex('Color #7f4')).toEqual([
      { type: 'text', value: 'Color ' },
      { type: 'hex', value: '#7f4', normalized: '#77ff44' },
    ])
  })

  it('strips alpha from 8-digit hex for swatch fill', function eightDigitHex() {
    expect(parseCommitMessageHex('Fade #11223344')).toEqual([
      { type: 'text', value: 'Fade ' },
      { type: 'hex', value: '#11223344', normalized: '#112233' },
    ])
  })

  it('does not treat hash-only fragments as hex without valid length', function invalidHex() {
    expect(parseCommitMessageHex('Issue #42 fixed')).toEqual([
      { type: 'text', value: 'Issue #42 fixed' },
    ])
  })

  it('handles empty message', function emptyMessage() {
    expect(parseCommitMessageHex('')).toEqual([{ type: 'text', value: '' }])
  })
})
