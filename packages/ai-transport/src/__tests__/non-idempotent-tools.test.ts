import { describe, it, expect } from 'vitest'
import { hasNonIdempotentTools } from '../non-idempotent-tools.js'

describe('hasNonIdempotentTools', () => {
  it('returns false for empty list', () => {
    expect(hasNonIdempotentTools([])).toBe(false)
  })

  it('returns false for idempotent tools only', () => {
    expect(hasNonIdempotentTools(['readFile', 'str_replace_based_edit_tool', 'directoryListing'])).toBe(false)
  })

  it('returns true for socialPostPublish', () => {
    expect(hasNonIdempotentTools(['socialPostPublish'])).toBe(true)
  })

  it('detects skill-namespaced non-idempotent tools (actual runtime names)', () => {
    expect(hasNonIdempotentTools(['commerce__manage_products'])).toBe(true)
    expect(hasNonIdempotentTools(['commerce__manage_inventory'])).toBe(true)
    expect(hasNonIdempotentTools(['commerce__manage_pricing'])).toBe(true)
    expect(hasNonIdempotentTools(['commerce__manage_media'])).toBe(true)
    expect(hasNonIdempotentTools(['database__insertRow'])).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(hasNonIdempotentTools(['SOCIALPOSTPUBLISH'])).toBe(true)
    expect(hasNonIdempotentTools(['Commerce__Manage_Products'])).toBe(true)
  })

  it('returns false for idempotent skill-namespaced tools', () => {
    expect(hasNonIdempotentTools(['publishing__publish'])).toBe(false)
    expect(hasNonIdempotentTools(['database__getSchema'])).toBe(false)
    expect(hasNonIdempotentTools(['commerce__fetchCatalog'])).toBe(false)
  })

  it('detects non-idempotent in mixed list', () => {
    expect(hasNonIdempotentTools(['readFile', 'commerce__manage_products', 'str_replace_based_edit_tool'])).toBe(true)
  })

  it('returns false for tools with similar names that are not in the list', () => {
    expect(hasNonIdempotentTools(['manageSettings'])).toBe(false)
    expect(hasNonIdempotentTools(['publishStatus'])).toBe(false)
  })

  it('does not match old camelCase tool names (regression guard)', () => {
    expect(hasNonIdempotentTools(['commerce__manageProducts'])).toBe(false)
    expect(hasNonIdempotentTools(['commerce__manageInventory'])).toBe(false)
  })
})
