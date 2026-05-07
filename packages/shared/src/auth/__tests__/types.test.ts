import { describe, expect, it } from 'vitest'

import { getMessageOriginForAuthType } from '../types.js'

describe('getMessageOriginForAuthType', () => {
  it.each([
    ['e2s', 'support'],
    ['e2s2s', 'support'],
    ['basic', 'customer'],
    [undefined, 'customer'],
  ] as const)('maps %s auth type to %s origin', (authType, expectedOrigin) => {
    expect(getMessageOriginForAuthType(authType)).toBe(expectedOrigin)
  })
})
