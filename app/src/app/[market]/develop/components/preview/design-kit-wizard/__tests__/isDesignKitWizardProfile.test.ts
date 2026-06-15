import { describe, expect,it } from 'vitest'

import { DESIGN_KIT_WIZARD_PROFILE,isDesignKitWizardProfile } from '../isDesignKitWizardProfile'

describe('isDesignKitWizardProfile', () => {
  it('exposes the design-kit profile constant', () => {
    expect(DESIGN_KIT_WIZARD_PROFILE).toBe('initial-agent-design-kit')
  })

  it('is true only for the design-kit profile', () => {
    expect(isDesignKitWizardProfile(DESIGN_KIT_WIZARD_PROFILE)).toBe(true)
    expect(isDesignKitWizardProfile('initial-agent-design-system')).toBe(false)
    expect(isDesignKitWizardProfile(null)).toBe(false)
    expect(isDesignKitWizardProfile(undefined)).toBe(false)
  })

  it('returns false for empty or near-miss profile names', () => {
    expect(isDesignKitWizardProfile('')).toBe(false)
    expect(isDesignKitWizardProfile('initial-agent-design-kit-v2')).toBe(false)
    expect(isDesignKitWizardProfile('design-kit')).toBe(false)
    expect(isDesignKitWizardProfile('initial-agent')).toBe(false)
  })
})
