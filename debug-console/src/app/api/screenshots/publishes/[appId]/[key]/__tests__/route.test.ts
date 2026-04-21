import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger')
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
}))

describe('debug-console /api/screenshots/publishes/[appId]/[key] GET', () => {
  const APP_ID = 'app-123456'
  const KEY = 'deploy-abc'
  const BASE_URL = 'https://debug-console.dev-godaddy.com'
  let mockSend: ReturnType<typeof vi.fn>

  function makeRequest(appId: string, key: string) {
    return new NextRequest(
      new URL(`${BASE_URL}/api/screenshots/publishes/${appId}/${key}`),
      { method: 'GET' }
    )
  }

  function makeParams(appId: string, key: string) {
    return { params: Promise.resolve({ appId, key }) }
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

    for (const invalidId of ['app@123', 'app 123', 'app/123']) {
      const response = await GET(makeRequest(invalidId, KEY), makeParams(invalidId, KEY))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Invalid appId format' })
    }
  })

  it('returns 400 for invalid key format', async () => {
    const { GET } = await import('../route')

    for (const invalidKey of ['key@1', 'key 1', '../key']) {
      const response = await GET(makeRequest(APP_ID, invalidKey), makeParams(APP_ID, invalidKey))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Invalid key format' })
    }
  })

  it('returns PNG stream when screenshot exists', async () => {
    const mockWebStream = new ReadableStream()
    mockSend.mockResolvedValue({
      Body: { transformToWebStream: vi.fn().mockReturnValue(mockWebStream) },
    })

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID, KEY), makeParams(APP_ID, KEY))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toContain('no-cache')
    expect(response.headers.get('Content-Disposition')).toContain(`${APP_ID}-${KEY}`)
  })

  it('uses correct S3 key path', async () => {
    const mockWebStream = new ReadableStream()
    mockSend.mockResolvedValue({
      Body: { transformToWebStream: vi.fn().mockReturnValue(mockWebStream) },
    })

    const { GET } = await import('../route')
    await GET(makeRequest(APP_ID, KEY), makeParams(APP_ID, KEY))

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Key: `snapshots/${APP_ID}/publishes/${KEY}/screenshot.png` })
    )
  })

  it('returns 404 when screenshot not found (NoSuchKey)', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
    )

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID, KEY), makeParams(APP_ID, KEY))

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Screenshot not found' })
  })

  it('returns 404 when S3 body is null', async () => {
    mockSend.mockResolvedValue({ Body: null })

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID, KEY), makeParams(APP_ID, KEY))

    expect(response.status).toBe(404)
  })

  it('returns 500 on unexpected S3 error', async () => {
    mockSend.mockRejectedValue(new Error('Access Denied'))

    const { GET } = await import('../route')
    const response = await GET(makeRequest(APP_ID, KEY), makeParams(APP_ID, KEY))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Failed to retrieve screenshot' })
  })

  it('throws when EVAL_SNAPSHOTS_BUCKET is not set', async () => {
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', undefined)
    vi.resetModules()

    vi.mocked(S3Client).mockImplementation(function mockClient() {
      return { send: vi.fn() } as any
    })

    const { GET } = await import('../route')

    await expect(
      GET(makeRequest(APP_ID, KEY), makeParams(APP_ID, KEY))
    ).rejects.toThrow('EVAL_SNAPSHOTS_BUCKET environment variable is not set')
  })
})
