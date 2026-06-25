import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => instance,
  }
  return {
    logger: instance,
    Logger: { create: () => instance },
  }
})

import { socialConnectTool } from '../index.js'
import { CONNECT_REQUEST_FROM_PUBLISH } from '../../../../types/social.js'

function runTool(
  input: Record<string, unknown>,
  context?: Record<string, unknown>
) {
  return socialConnectTool.execute(input, context)
}

describe('socialConnectTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct name and parameters', () => {
    expect(socialConnectTool.name).toBe('socialConnect')
    expect(socialConnectTool.parameters).toBeDefined()
  })

  it('throws when appId is missing from context', async () => {
    await expect(
      runTool({ platform: 'FACEBOOK' }, { metadata: {} })
    ).rejects.toThrow('socialConnect: missing appId in context metadata')
  })

  it('throws when context is undefined', async () => {
    await expect(
      runTool({ platform: 'FACEBOOK' })
    ).rejects.toThrow('socialConnect: missing appId in context metadata')
  })

  it('returns connect signal for valid platform', async () => {
    const result = await runTool(
      { platform: 'FACEBOOK' },
      { metadata: { appId: 'test-app-123' } }
    )

    expect(result).toMatchObject({
      action: 'connect',
      success: true,
      platform: 'FACEBOOK',
      appId: 'test-app-123',
    })
    expect(result.state).toMatch(/^FACEBOOK-\d+-[a-z0-9]+$/)
  })

  it('returns connect signal for Instagram', async () => {
    const result = await runTool(
      { platform: 'INSTAGRAM' },
      { metadata: { appId: 'app-456' } }
    )

    expect(result).toMatchObject({
      action: 'connect',
      success: true,
      platform: 'INSTAGRAM',
      appId: 'app-456',
    })
  })

  it('returns connect signal for Google Business Profile', async () => {
    const result = await runTool(
      { platform: 'GOOGLE_BUSINESS_PROFILE' },
      { metadata: { appId: 'app-789' } }
    )

    expect(result).toMatchObject({
      action: 'connect',
      success: true,
      platform: 'GOOGLE_BUSINESS_PROFILE',
      appId: 'app-789',
    })
  })

  it('returns connect signal for Google Search Console', async () => {
    const result = await runTool(
      { platform: 'GOOGLE_SEARCH_CONSOLE' },
      { metadata: { appId: 'app-gsc-01' } }
    )

    expect(result).toMatchObject({
      action: 'connect',
      success: true,
      platform: 'GOOGLE_SEARCH_CONSOLE',
      appId: 'app-gsc-01',
    })
    expect(result.state).toMatch(/^GOOGLE_SEARCH_CONSOLE-\d+-[a-z0-9]+$/)
  })

  it('includes pending publish data from context attachments', async () => {
    const pendingPublish = { message: 'Hello world', imageUrls: [] }
    const postData = { styleLabel: 'casual' }

    const result = await runTool(
      { platform: 'FACEBOOK' },
      {
        metadata: { appId: 'test-app' },
        contextAttachments: [
          {
            type: CONNECT_REQUEST_FROM_PUBLISH,
            data: {
              platforms: ['FACEBOOK', 'INSTAGRAM'],
              pendingPublish,
              postData,
            },
          },
        ],
      }
    )

    expect(result).toMatchObject({
      action: 'connect',
      success: true,
      platform: 'FACEBOOK',
      platforms: ['FACEBOOK', 'INSTAGRAM'],
      pendingPublish,
      postData,
    })
  })

  it('returns undefined for publish fields when no context attachment', async () => {
    const result = await runTool(
      { platform: 'FACEBOOK' },
      { metadata: { appId: 'test-app' }, contextAttachments: [] }
    )

    expect(result.pendingPublish).toBeUndefined()
    expect(result.postData).toBeUndefined()
    expect(result.platforms).toBeUndefined()
  })
})
