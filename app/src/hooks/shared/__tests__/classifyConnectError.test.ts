import { describe, expect, it } from 'vitest'

import { classifyConnectError } from '../classifyConnectError'

describe('classifyConnectError', () => {
  it('classifies SITE_NOT_FOUND as deterministic', () => {
    expect(classifyConnectError(new Error('SITE_NOT_FOUND'))).toBe('deterministic')
  })
  it('classifies agent-token 404/403 as deterministic', () => {
    expect(classifyConnectError(new Error('Failed to get agent token: 404'))).toBe('deterministic')
    expect(classifyConnectError(new Error('Failed to get agent token: 403'))).toBe('deterministic')
  })
  it('classifies agent-token 401/500 as network (not deterministic)', () => {
    expect(classifyConnectError(new Error('Failed to get agent token: 401'))).toBe('network')
    expect(classifyConnectError(new Error('Failed to get agent token: 503'))).toBe('network')
  })
  it('classifies "agent is not ready yet" as provisioning', () => {
    expect(classifyConnectError(new Error('Site app_1 agent is not ready yet. Status: creating'))).toBe('provisioning')
  })
  it('classifies opaque network strings as network', () => {
    expect(classifyConnectError(new Error('Failed to fetch'))).toBe('network')
    expect(classifyConnectError(new Error('Load failed'))).toBe('network')
    expect(classifyConnectError('weird non-error')).toBe('network')
  })
})
