import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@airo/ai-lib'
import { resolveInitialVariantForProfileHandoff } from '../initial-variant-resolution.js'

describe('resolveInitialVariantForProfileHandoff', function resolutionTests() {
  const initialV2 = { id: 'initial-v2' } as AgentConfig
  const initialV3 = { id: 'initial-v3' } as AgentConfig

  it('returns v2 config when promptVersion is 2.0', function v2() {
    const modular = { id: 'initial-v3-x' } as AgentConfig
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '2.0',
      profileName: 'x',
      profileInitialV3ModularConfigs: { 'initial-v3-x': modular },
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result?.id).toBe('initial-v2')
  })

  it('uses modular variant when only modularPromptFiles implies v3 family (no promptVersion)', function modularOnly() {
    const modular = { id: 'initial-v3-x' } as AgentConfig
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '',
      profileName: 'x',
      profileInitialV3ModularConfigs: { 'initial-v3-x': modular },
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result?.id).toBe('initial-v3-x')
  })

  it('uses shared initial-v3 when promptVersion is 3.0 and no modular entry exists', function v3Shared() {
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '3.0',
      profileName: 'plain',
      profileInitialV3ModularConfigs: {},
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result?.id).toBe('initial-v3')
  })

  it('prefers modular variant over shared initial-v3 when both apply', function modularOverShared() {
    const modular = { id: 'initial-v3-p' } as AgentConfig
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '3.0',
      profileName: 'p',
      profileInitialV3ModularConfigs: { 'initial-v3-p': modular },
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result).toBe(modular)
  })

  it('returns null when promptVersion is empty and no modular variant', function none() {
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '',
      profileName: 'noop',
      profileInitialV3ModularConfigs: {},
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result).toBeNull()
  })

  it('returns v2 when promptVersion is 2.0 even if a modular variant exists (handoff wiring priority)', function v2BeatsModular() {
    const modular = { id: 'initial-v3-mixed' } as AgentConfig
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '2.0',
      profileName: 'mixed',
      profileInitialV3ModularConfigs: { 'initial-v3-mixed': modular },
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result?.id).toBe('initial-v2')
  })

  it('returns the named-variant config when promptVersion is a registered non-numeric name', function namedVariant() {
    const named = { id: 'initial-prompt-enhancer' } as AgentConfig
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: 'prompt-enhancer',
      profileName: 'enhancer',
      profileInitialV3ModularConfigs: {},
      namedVariantInitialConfigs: { 'initial-prompt-enhancer': named },
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result).toBe(named)
  })

  it('returns null when named-variant promptVersion is not registered', function namedVariantMissing() {
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: 'prompt-enhancer',
      profileName: 'enhancer',
      profileInitialV3ModularConfigs: {},
      namedVariantInitialConfigs: {},
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result).toBeNull()
  })

  it('ignores numeric-like promptVersion in the named-variant branch (e.g. future "4.0")', function numericFuture() {
    const result = resolveInitialVariantForProfileHandoff({
      promptVersion: '4.0',
      profileName: 'future',
      profileInitialV3ModularConfigs: {},
      namedVariantInitialConfigs: { 'initial-4.0': { id: 'initial-4.0' } as AgentConfig },
      initialV2Config: initialV2,
      initialV3Config: initialV3,
    })
    expect(result).toBeNull()
  })
})
