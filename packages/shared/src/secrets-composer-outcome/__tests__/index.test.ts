import { describe, expect, it } from 'vitest'

import {
  buildSecretsComposerCancelUserMessage,
  buildSecretsComposerSuccessUserMessage,
  isSecretsComposerCancelUserContent,
  isSecretsComposerSuccessUserContent,
  parseSecretsComposerOutcomeKind,
  stripSecretsComposerOutcomeTag,
} from '../index.js'

describe('secrets-composer-outcome', () => {
  describe('buildSecretsComposerCancelUserMessage', () => {
    it('uses a locale-stable tag only', () => {
      expect(buildSecretsComposerCancelUserMessage()).toBe('[[secrets-composer-outcome:cancel]]')
    })
  })

  describe('buildSecretsComposerSuccessUserMessage', () => {
    it('prefixes single-secret success', () => {
      expect(buildSecretsComposerSuccessUserMessage('add', ['OPENAI_API_KEY'])).toBe(
        '[[secrets-composer-outcome:added]] Secret added successfully: OPENAI_API_KEY',
      )
    })

    it('prefixes multi-secret success', () => {
      expect(buildSecretsComposerSuccessUserMessage('add', ['A', 'B'])).toBe(
        '[[secrets-composer-outcome:added]] Secrets added successfully: A, B',
      )
    })
  })

  describe('isSecretsComposerCancelUserContent', () => {
    it('matches tagged cancel', () => {
      expect(isSecretsComposerCancelUserContent('[[secrets-composer-outcome:cancel]]')).toBe(true)
    })

    it('matches legacy English cancel', () => {
      expect(
        isSecretsComposerCancelUserContent('I cancelled entering the requested secret(s).'),
      ).toBe(true)
    })

    it('rejects unrelated text', () => {
      expect(isSecretsComposerCancelUserContent('Annuler les secrets')).toBe(false)
    })
  })

  describe('isSecretsComposerSuccessUserContent', () => {
    it('matches tagged success', () => {
      expect(
        isSecretsComposerSuccessUserContent(
          '[[secrets-composer-outcome:added]] Secret added successfully: KEY',
        ),
      ).toBe(true)
    })

    it('matches legacy success without tag', () => {
      expect(isSecretsComposerSuccessUserContent('Secret updated successfully: KEY')).toBe(true)
    })

    it('matches legacy success with Please continue suffix', () => {
      expect(
        isSecretsComposerSuccessUserContent(
          'Secrets added successfully: OPENAI_API_KEY. Please continue.',
        ),
      ).toBe(true)
    })

    it('matches legacy saved phrasing', () => {
      expect(isSecretsComposerSuccessUserContent('Secrets saved successfully: KEY')).toBe(true)
    })
  })

  describe('stripSecretsComposerOutcomeTag', () => {
    it('removes tag and leaves human-readable tail', () => {
      expect(
        stripSecretsComposerOutcomeTag(
          '[[secrets-composer-outcome:added]] Secret added successfully: X',
        ),
      ).toBe('Secret added successfully: X')
    })
  })

  describe('parseSecretsComposerOutcomeKind', () => {
    it('returns cancel for cancel tag', () => {
      expect(parseSecretsComposerOutcomeKind('[[secrets-composer-outcome:cancel]]')).toBe('cancel')
    })
  })
})
