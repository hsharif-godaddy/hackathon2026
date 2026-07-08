// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { DESIGN_KIT_WIZARD_PROFILE, isDesignKitWizardProfile, useIsDesignKitWizardProfile } from '../isDesignKitWizardProfile'

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

describe('useIsDesignKitWizardProfile', () => {
  afterEach(() => {
    useDevelopPageStore.setState({ app: null })
    ;(window as unknown as { gasketData?: unknown }).gasketData = undefined
  })

  it('returns true when app.agentProfile matches the design-kit profile', () => {
    useDevelopPageStore.setState({ app: { agentProfile: 'initial-agent-design-kit' } as never })
    const { result } = renderHook(() => useIsDesignKitWizardProfile())
    expect(result.current).toBe(true)
  })

  it('returns false when app.agentProfile is a different profile', () => {
    useDevelopPageStore.setState({ app: { agentProfile: 'initial-v3' } as never })
    const { result } = renderHook(() => useIsDesignKitWizardProfile())
    expect(result.current).toBe(false)
  })

  it('returns false when app is null (loading state)', () => {
    useDevelopPageStore.setState({ app: null })
    const { result } = renderHook(() => useIsDesignKitWizardProfile())
    expect(result.current).toBe(false)
  })

  it('is independent of any Switchboard value', () => {
    (window as unknown as { gasketData?: unknown }).gasketData = {
      switchboard: { 'appbuilder-agent-profile': 'initial-agent-design-kit' },
    }
    useDevelopPageStore.setState({ app: { agentProfile: undefined } as never })
    const { result } = renderHook(() => useIsDesignKitWizardProfile())
    expect(result.current).toBe(false)
  })
})
