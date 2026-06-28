import { getDefaultAnthropicProxyEndpoint, getDefaultGoCodeEndpoint } from '@airo/ai-lib'
import { describe, expect, it } from 'vitest'

import { parseProviderPrefix, resolveUpstream, type AgentsEnv } from '../resolve.js'

const S2S: AgentsEnv = { s2s: true }
const API_KEY: AgentsEnv = {
  s2s: false,
  openaiBaseUrl: 'https://litellm.example.com',
  anthropicBaseUrl: 'https://litellm.example.com',
}

describe('parseProviderPrefix', () => {
  it('splits prefix from the upstream-relative path', () => {
    expect(parseProviderPrefix('/u/gocode/v1/messages')).toEqual({
      provider: 'gocode',
      path: '/v1/messages',
    })
  })

  it('preserves the query string', () => {
    expect(parseProviderPrefix('/u/anthropic/v1/messages?beta=true')).toEqual({
      provider: 'anthropic',
      path: '/v1/messages?beta=true',
    })
  })

  it('defaults to root path when only the prefix is present', () => {
    expect(parseProviderPrefix('/u/openai')).toEqual({ provider: 'openai', path: '/' })
  })

  it('returns null for unknown providers and non-prefixed URLs', () => {
    expect(parseProviderPrefix('/u/bogus/v1/messages')).toBeNull()
    expect(parseProviderPrefix('/v1/messages')).toBeNull()
  })
})

describe('resolveUpstream', () => {
  const goCode: string = stripTrailingSlash(getDefaultGoCodeEndpoint())

  it('always routes the gocode prefix to the ai-lib GoCode endpoint', () => {
    expect(resolveUpstream('gocode', { agentsEnv: S2S })).toBe(goCode)
    expect(resolveUpstream('gocode', { agentsEnv: API_KEY })).toBe(goCode)
  })

  it('collapses openai and anthropic onto GoCode in s2s mode', () => {
    expect(resolveUpstream('openai', { agentsEnv: S2S })).toBe(goCode)
    expect(resolveUpstream('anthropic', { agentsEnv: S2S })).toBe(goCode)
  })

  it('routes to the agent-configured upstreams in api-key mode', () => {
    expect(resolveUpstream('openai', { agentsEnv: API_KEY })).toBe('https://litellm.example.com')
    expect(resolveUpstream('anthropic', { agentsEnv: API_KEY })).toBe('https://litellm.example.com')
  })

  it('falls back to ai-lib defaults when api-key base URLs are absent', () => {
    expect(resolveUpstream('anthropic', { agentsEnv: { s2s: false } })).toBe(
      stripTrailingSlash(getDefaultAnthropicProxyEndpoint()),
    )
    expect(resolveUpstream('openai', { agentsEnv: { s2s: false } })).toBe(goCode)
  })

  it('ignores an agent base URL that loops back at the proxy (self-reference guard)', () => {
    expect(
      resolveUpstream('anthropic', {
        agentsEnv: { s2s: false, anthropicBaseUrl: 'http://127.0.0.1:8788/u/anthropic' },
        proxyOrigin: 'http://127.0.0.1:8788',
      }),
    ).toBe(stripTrailingSlash(getDefaultAnthropicProxyEndpoint()))
  })

  it('defaults to s2s when no agent env is provided', () => {
    expect(resolveUpstream('openai')).toBe(goCode)
  })
})

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
