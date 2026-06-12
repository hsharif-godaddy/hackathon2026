/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

import {
  loadResolvedSecretsComposerToolCallIds,
  mergeResolvedSecretsComposerToolCallIds,
  saveResolvedSecretsComposerToolCallIds,
} from '@/app/[market]/develop/components/chat/secrets/resolvedSecretsComposerStorage'
import { logger } from '@/lib/request-context'

describe('resolvedSecretsComposerStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('persists and reloads resolved tool call keys per app', () => {
    saveResolvedSecretsComposerToolCallIds('app-1', {
      'tc-1:batch': true,
      'tc-1:OPENAI_API_KEY': true,
    })

    expect(loadResolvedSecretsComposerToolCallIds('app-1')).toEqual({
      'tc-1:batch': true,
      'tc-1:OPENAI_API_KEY': true,
    })
    expect(loadResolvedSecretsComposerToolCallIds('app-2')).toEqual({})
  })

  it('merges stored ids with in-memory ids', () => {
    saveResolvedSecretsComposerToolCallIds('app-1', { 'tc-old:batch': true })

    expect(
      mergeResolvedSecretsComposerToolCallIds('app-1', { 'tc-new:batch': true }),
    ).toEqual({
      'tc-old:batch': true,
      'tc-new:batch': true,
    })
  })

  it('returns empty object and logs warning when localStorage contains corrupt data', () => {
    localStorage.setItem('airo-secrets-composer-resolved:app-1', 'invalid-json{')

    const result = loadResolvedSecretsComposerToolCallIds('app-1')

    expect(result).toEqual({})
    expect(logger.warn).toHaveBeenCalledWith(
      'secrets.resolved.storage.unreadable',
      expect.objectContaining({
        appId: 'app-1',
        error: expect.any(Error),
      }),
    )
  })
})
