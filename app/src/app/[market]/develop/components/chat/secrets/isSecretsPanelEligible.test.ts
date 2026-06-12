import { describe, expect, it } from 'vitest'

import { isSecretsPanelEligible } from '@/app/[market]/develop/components/chat/secrets/isSecretsPanelEligible'
import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'

function basePayload(overrides: Partial<SecretsRequestPayload> = {}): SecretsRequestPayload {
  return {
    type: 'secrets_request',
    title: 'Title',
    description: 'Description',
    secrets: [{ name: 'API_KEY', description: 'Your key', required: true }],
    mode: 'add',
    ...overrides,
  }
}

describe('isSecretsPanelEligible', () => {
  it('returns true for a single named secret without autoSubmit or allowMultiple', () => {
    expect(isSecretsPanelEligible(basePayload())).toBe(true)
  })

  it('returns false when autoSubmit is true', () => {
    expect(isSecretsPanelEligible(basePayload({ autoSubmit: true }))).toBe(false)
  })

  it('returns false when allowMultiple is true', () => {
    expect(isSecretsPanelEligible(basePayload({ allowMultiple: true }))).toBe(false)
  })

  it('returns false when secrets array is empty', () => {
    expect(isSecretsPanelEligible(basePayload({ secrets: [] }))).toBe(false)
  })

  it('returns true when more than one secret is defined (paginated mode supported)', () => {
    expect(
      isSecretsPanelEligible(
        basePayload({
          secrets: [
            { name: 'A', required: true },
            { name: 'B', required: true },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('returns false when the sole secret has an empty name', () => {
    expect(isSecretsPanelEligible(basePayload({ secrets: [{ name: '   ', required: true }] }))).toBe(
      false,
    )
  })

  it('returns true when optional flags are omitted', () => {
    const p = basePayload()
    delete (p as { allowMultiple?: boolean }).allowMultiple
    delete (p as { autoSubmit?: boolean }).autoSubmit
    expect(isSecretsPanelEligible(p)).toBe(true)
  })
})
