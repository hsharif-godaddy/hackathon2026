import { S3Client } from '@aws-sdk/client-s3'
import { logger } from '@/lib/logger'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger')
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  ListObjectsV2Command: vi.fn().mockImplementation(function cmd(input: unknown) { return { input } }),
  GetObjectCommand: vi.fn().mockImplementation(function cmd(input: unknown) { return { input } }),
}))

describe('debug-console /api/screenshots/publishes/[appId] GET', () => {
  const APP_ID = 'app-123456'
  const BASE_URL = 'https://debug-console.dev-godaddy.com'
  let mockSend: ReturnType<typeof vi.fn>

  function makeRequest(appId: string) {
    return new NextRequest(
      new URL(`${BASE_URL}/api/screenshots/publishes/${appId}`),
      { method: 'GET' }
    )
  }

  function makeParams(appId: string) {
    return { params: Promise.resolve({ appId }) }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', 'airo-eval-snapshots-test')
    mockSend = vi.fn()
    vi.mocked(S3Client).mockImplementation(function mockClient() {
      return { send: mockSend } as any
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns 400 for invalid appId format', async () => {
    const { GET } = await import('../route')

    for (const invalidId of ['app@123', 'app 123', 'app/123', '../app']) {
      const response = await GET(makeRequest(invalidId), makeParams(invalidId))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Invalid appId format' })
    }
  })

  it('returns empty snapshots array when no publishes exist', async () => {
    mockSend.mockResolvedValue({ CommonPrefixes: [] })

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID), makeParams(APP_ID))

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.appId).toBe(APP_ID)
    expect(data.snapshots).toEqual([])
  })

  it('includes full URL with origin in screenshotUrl', async () => {
    const manifest = { deploymentId: 'deploy-abc', commitHash: 'ff23df7', capturedAt: '2026-04-14T10:00:00.000Z', deploymentStatus: 'deployed' }
    mockSend
      .mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: `snapshots/${APP_ID}/publishes/deploy-abc/` }] })
      .mockResolvedValueOnce({ Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(manifest)) } })

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID), makeParams(APP_ID))

    const data = await response.json()
    expect(data.snapshots[0].screenshotUrl).toBe(
      `${BASE_URL}/api/screenshots/publishes/${APP_ID}/deploy-abc`
    )
  })

  it('uses x-forwarded-host and x-forwarded-proto for screenshotUrl when set', async () => {
    const manifest = { deploymentId: 'deploy-abc', commitHash: 'ff23df7', capturedAt: '2026-04-14T10:00:00.000Z', deploymentStatus: 'deployed' }
    mockSend
      .mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: `snapshots/${APP_ID}/publishes/deploy-abc/` }] })
      .mockResolvedValueOnce({ Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(manifest)) } })

    const { GET } = await import('../route')
    const request = new NextRequest(
      new URL(`${BASE_URL}/api/screenshots/publishes/${APP_ID}`),
      {
        method: 'GET',
        headers: {
          'x-forwarded-host': 'debug-console.godaddy.com',
          'x-forwarded-proto': 'https',
        },
      }
    )
    const response = await GET(request, makeParams(APP_ID))

    const data = await response.json()
    expect(data.snapshots[0].screenshotUrl).toBe(
      `https://debug-console.godaddy.com/api/screenshots/publishes/${APP_ID}/deploy-abc`
    )
  })

  it('returns snapshots sorted by capturedAt descending', async () => {
    const manifest1 = { deploymentId: 'deploy-1', commitHash: 'aaa', capturedAt: '2026-04-10T10:00:00.000Z', deploymentStatus: 'deployed' }
    const manifest2 = { deploymentId: 'deploy-2', commitHash: 'bbb', capturedAt: '2026-04-14T10:00:00.000Z', deploymentStatus: 'deployed' }

    // First call is ListObjectsV2, subsequent calls are GetObject for each manifest
    mockSend
      .mockResolvedValueOnce({
        CommonPrefixes: [
          { Prefix: `snapshots/${APP_ID}/publishes/deploy-1/` },
          { Prefix: `snapshots/${APP_ID}/publishes/deploy-2/` },
        ],
      })
      .mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(manifest1)) },
      })
      .mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify(manifest2)) },
      })

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID), makeParams(APP_ID))

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.snapshots).toHaveLength(2)
    expect(data.snapshots[0].key).toBe('deploy-2')
    expect(data.snapshots[1].key).toBe('deploy-1')
  })

  it('returns 200 with null fields and logs warn when manifest fetch fails', async () => {
    mockSend
      .mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: `snapshots/${APP_ID}/publishes/deploy-abc/` }] })
      .mockRejectedValueOnce(new Error('Access Denied'))

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID), makeParams(APP_ID))

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.snapshots).toHaveLength(1)
    expect(data.snapshots[0].key).toBe('deploy-abc')
    expect(data.snapshots[0].capturedAt).toBeNull()
    expect(data.snapshots[0].deploymentId).toBeNull()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'screenshots.publishes.manifest.fetch-failed',
      expect.objectContaining({ appId: APP_ID, key: 'deploy-abc', error: 'Access Denied' })
    )
  })

  it('filters out keys with invalid characters from S3 prefixes', async () => {
    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [
        { Prefix: `snapshots/${APP_ID}/publishes/deploy-valid/` },
        { Prefix: `snapshots/${APP_ID}/publishes/deploy invalid/` },
        { Prefix: `snapshots/${APP_ID}/publishes/deploy@bad/` },
      ],
    })
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: vi.fn().mockResolvedValue(JSON.stringify({ capturedAt: '2026-04-14T10:00:00.000Z' })) },
    })

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID), makeParams(APP_ID))

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.snapshots).toHaveLength(1)
    expect(data.snapshots[0].key).toBe('deploy-valid')
  })

  it('returns 500 on S3 list error', async () => {
    mockSend.mockRejectedValue(new Error('Network error'))

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID), makeParams(APP_ID))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Failed to list publish snapshots' })
  })

  it('throws when EVAL_SNAPSHOTS_BUCKET is not set', async () => {
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', undefined)
    vi.resetModules()

    vi.mocked(S3Client).mockImplementation(function mockClient() {
      return { send: vi.fn() } as any
    })

    const { GET } = await import('../route')

    await expect(
      GET(makeRequest(APP_ID), makeParams(APP_ID))
    ).rejects.toThrow('EVAL_SNAPSHOTS_BUCKET environment variable is not set')
  })
})
