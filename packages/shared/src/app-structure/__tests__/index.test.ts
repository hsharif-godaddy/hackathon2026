import { describe, expect, it } from 'vitest'

import { APP_DIRECTORIES } from '../index.js'

describe('app structure', () => {
  it('includes format override sidecars in app source exports', () => {
    expect(APP_DIRECTORIES).toContain('format-overrides')
  })
})
