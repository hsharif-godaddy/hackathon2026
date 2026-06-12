import { describe, expect, it } from 'vitest'

import { secretsPanelTitle } from '@/app/[market]/develop/components/chat/secrets/secretsPanelTitle'
import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'

function payload(overrides: Partial<SecretsRequestPayload> = {}): SecretsRequestPayload {
  return {
    type: 'secrets_request',
    title: 'Twilio credentials',
    description: 'From the Twilio console',
    secrets: [
      { name: 'TWILIO_ACCOUNT_SID', required: true },
      { name: 'TWILIO_AUTH_TOKEN', required: true },
    ],
    mode: 'add',
    ...overrides,
  }
}

describe('secretsPanelTitle', () => {
  it('uses agent title when provided', () => {
    expect(secretsPanelTitle(payload())).toBe('Twilio credentials')
  })

  it('derives subject from shared secret prefix when title is generic', () => {
    expect(
      secretsPanelTitle(
        payload({
          title: 'Add Secrets',
          description: '',
          secrets: [{ name: 'STRIPE_SECRET_KEY', required: true }],
        }),
      ),
    ).toBe('Stripe')
  })

  it('uses description lead when title is generic and names do not share a prefix', () => {
    expect(
      secretsPanelTitle(
        payload({
          title: 'Update Secret',
          secrets: [
            { name: 'AWS_ACCESS_KEY_ID', required: true },
            { name: 'STRIPE_SECRET_KEY', required: true },
          ],
          description: 'Paste keys from each provider console.',
        }),
      ),
    ).toBe('Paste keys from each provider console')
  })

  it('strips trailing Required from agent title', () => {
    expect(
      secretsPanelTitle(
        payload({
          title: 'Stripe API Keys Required',
        }),
      ),
    ).toBe('Stripe API Keys')
  })

  it('prefers per-secret description over env var name', () => {
    expect(
      secretsPanelTitle(
        payload({
          title: 'Add Secrets',
          description: '',
          secrets: [
            {
              name: 'OPENAI_API_KEY',
              description: 'OpenAI API key from platform.openai.com',
              required: true,
            },
          ],
        }),
      ),
    ).toBe('OpenAI API key from platform.openai.com')
  })
})
