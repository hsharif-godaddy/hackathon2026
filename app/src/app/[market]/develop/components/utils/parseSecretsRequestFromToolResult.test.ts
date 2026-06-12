import { describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/request-context'
import { parseSecretsRequestFromToolResult } from './parseSecretsRequestFromToolResult'

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

describe('parseSecretsRequestFromToolResult', () => {
  it('returns a typed payload for a valid tool result', function validResult() {
    const parsed = parseSecretsRequestFromToolResult({
      secretsRequired: true,
      secretsRequest: {
        type: 'secrets_request',
        title: 'API key',
        description: 'From dashboard',
        secrets: [{ name: 'OPENAI_API_KEY', required: true }],
        mode: 'add',
      },
    })

    expect(parsed).toEqual({
      type: 'secrets_request',
      title: 'API key',
      description: 'From dashboard',
      secrets: [{ name: 'OPENAI_API_KEY', required: true }],
      mode: 'add',
      allowMultiple: false,
      showSettingsLink: true,
      autoSubmit: false,
      existingSecretNames: undefined,
    })
  })

  it('allows an empty secrets array for open-ended flows', function emptySecrets() {
    const parsed = parseSecretsRequestFromToolResult({
      secretsRequired: true,
      secretsRequest: {
        title: 'Add secrets',
        description: 'Add any keys',
        secrets: [],
        mode: 'add',
        allowMultiple: true,
      },
    })

    expect(parsed?.secrets).toEqual([])
    expect(parsed?.allowMultiple).toBe(true)
  })

  it('returns null and logs when mode is invalid', function invalidMode() {
    const parsed = parseSecretsRequestFromToolResult(
      {
        secretsRequired: true,
        secretsRequest: {
          title: 'T',
          description: 'D',
          secrets: [{ name: 'KEY' }],
          mode: 'replace',
        },
      },
      { toolCallId: 'tc-bad' },
    )

    expect(parsed).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith('secrets.request.payload.invalid', {
      toolCallId: 'tc-bad',
      reason: 'mode',
    })
  })

  it('returns null when a secret item lacks a string name', function invalidSecretItem() {
    const parsed = parseSecretsRequestFromToolResult({
      secretsRequired: true,
      secretsRequest: {
        title: 'T',
        description: 'D',
        secrets: [{ name: 123 }],
        mode: 'add',
      },
    })

    expect(parsed).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      'secrets.request.payload.invalid',
      expect.objectContaining({ reason: 'secret_definition' }),
    )
  })

  it('returns null when secretsRequired is false', function notRequired() {
    expect(
      parseSecretsRequestFromToolResult({
        secretsRequired: false,
        secretsRequest: {
          title: 'T',
          description: 'D',
          secrets: [{ name: 'KEY' }],
          mode: 'add',
        },
      }),
    ).toBeNull()
  })

  it('unwraps secrets fields from a nested output object', function nestedOutput() {
    const parsed = parseSecretsRequestFromToolResult({
      output: {
        secretsRequired: true,
        secretsRequest: {
          type: 'secrets_request',
          title: 'Twilio',
          description: 'Console keys',
          secrets: [
            { name: 'TWILIO_ACCOUNT_SID', required: true },
            { name: 'TWILIO_AUTH_TOKEN', required: true },
          ],
          mode: 'add',
        },
      },
    })

    expect(parsed?.secrets).toHaveLength(2)
    expect(parsed?.secrets[0]?.name).toBe('TWILIO_ACCOUNT_SID')
  })
})
