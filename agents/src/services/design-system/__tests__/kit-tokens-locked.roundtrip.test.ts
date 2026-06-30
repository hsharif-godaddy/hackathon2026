import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { KnownAppMetadata } from '@airo/shared'
import { initializeTestDatabase } from '../../../database/schema.js'
import * as connection from '../../../database/connection.js'
import { AppMetadataRepository } from '../../../database/repositories/AppMetadataRepository.js'
import { kitTokensLocked, lockKitTokens } from '../kit-tokens-locked.js'

// AIROBUILD-2665 / Fix B — real write→read round-trip for the `designKitTokensLocked`
// marker against an in-memory SQLite DB (NOT a mocked repository). The unit tests in
// kit-tokens-locked.test.ts mock AppMetadataRepository, and forced-install.test.ts only
// asserts the `merge` call — so a typo in the key string on either side would survive both
// halves. This exercises the genuine merge (mirroring forced-install.ts's write verbatim)
// through the real repository and reads it back through the real kitTokensLocked helper,
// so the persisted column + key string are verified end to end. (The write key is also
// compile-coupled via `satisfies Partial<KnownAppMetadata>`; this guards the read side and
// the repository mechanics.)

vi.mock('../../../database/connection.js')
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
    }),
  },
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

describe('kitTokensLocked — real metadata round-trip (AIROBUILD-2665)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeTestDatabase(db)
    vi.mocked(connection.getDatabase).mockReturnValue(db)
  })

  afterEach(() => {
    db.close()
  })

  it('is false before any marker is written', () => {
    expect(kitTokensLocked('rt-unwritten')).toBe(false)
  })

  it('is true after the exact forced-install write (merge → kitTokensLocked)', () => {
    // Mirror forced-install.ts's write verbatim — same key, same value.
    new AppMetadataRepository().merge('rt-locked', { designKitTokensLocked: true } satisfies Partial<KnownAppMetadata>)
    expect(kitTokensLocked('rt-locked')).toBe(true)
  })

  it('is true after lockKitTokens() — the real helper write pairs with the read', () => {
    // Exercise the genuine lockKitTokens() write (not a raw merge), so a regression
    // in its key/value or a swallow-instead-of-write would fail here end to end.
    lockKitTokens('rt-helper')
    expect(kitTokensLocked('rt-helper')).toBe(true)
  })

  it('does not leak across apps (only the written appId is locked)', () => {
    new AppMetadataRepository().merge('rt-owner', { designKitTokensLocked: true } satisfies Partial<KnownAppMetadata>)
    expect(kitTokensLocked('rt-other')).toBe(false)
  })
})
