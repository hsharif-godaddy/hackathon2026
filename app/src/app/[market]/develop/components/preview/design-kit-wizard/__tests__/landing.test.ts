import { describe, expect, it } from 'vitest'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { isDesignKitInitialViewResolving, resolveDesignKitInitialView } from '../landing'

describe('resolveDesignKitInitialView', () => {
  it('lands an in-progress design-kit session on the BRAND tab', () => {
    expect(resolveDesignKitInitialView(true, false)).toBe(ViewMode.BRAND)
  })

  it('lands a finished design-kit build in the normal builder (null, not the wizard)', () => {
    expect(resolveDesignKitInitialView(true, true)).toBeNull()
  })

  it('does not force a view for non-design-kit sessions', () => {
    expect(resolveDesignKitInitialView(false, false)).toBeNull()
    expect(resolveDesignKitInitialView(false, true)).toBeNull()
  })
})

describe('isDesignKitInitialViewResolving', () => {
  it('holds while a design-kit session is still loading its persisted phase', () => {
    expect(isDesignKitInitialViewResolving(true, false, true)).toBe(true)
  })

  it('does not hold once brand-data has settled', () => {
    expect(isDesignKitInitialViewResolving(true, false, false)).toBe(false)
  })

  it('does not hold a fresh create (initial prompt pending → known in-progress)', () => {
    expect(isDesignKitInitialViewResolving(true, true, true)).toBe(false)
  })

  it('does not hold for non-design-kit sessions', () => {
    expect(isDesignKitInitialViewResolving(false, false, true)).toBe(false)
  })
})
