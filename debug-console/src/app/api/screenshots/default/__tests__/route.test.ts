import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger')

vi.mock('@aws-sdk/client-s3')

describe('debug-console /api/screenshots/default/[appId] GET', () => {
  const mockAppId = 'app-123456'
  const devUrl = 'https://debug-console.dev-godaddy.com/api/screenshots/default/app-123'
  const prodUrl = 'https://debug-console.godaddy.com/api/screenshots/default/app-123'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', 'airo-eval-snapshots-test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('should return 400 for invalid appId format', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    const mockStream = {
      transformToWebStream: vi.fn().mockReturnValue(new ReadableStream()),
    }

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({ Body: mockStream }),
    }))

    const { GET } = await import('../route')

    const invalidIds = ['app@123', 'app 123', 'app/123', '../app']

    for (const invalidId of invalidIds) {
      const request = new NextRequest(
        new URL(`https://localhost/api/screenshots/default/${invalidId}`),
        { method: 'GET' }
      )

      const response = await GET(request, { params: Promise.resolve({ appId: invalidId }) })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Invalid appId format')
    }
  })

  it('should return 404 when screenshot not found in S3', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error('The specified key does not exist.'), {
          name: 'NoSuchKey',
        })
      ),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('Screenshot not found')
  })

  it('should return 500 on S3 access denied', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error('Access Denied'), {
          name: 'AccessDenied',
        })
      ),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toContain('Failed to retrieve screenshot')
  })

  it('should return 500 on unexpected S3 error', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockRejectedValue(new Error('Network timeout')),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(500)
  })

  it('should return PNG buffer when screenshot exists (dev bucket)', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    const mockWebStream = new ReadableStream()
    const mockStream = {
      transformToWebStream: vi.fn().mockReturnValue(mockWebStream),
    }

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({
        Body: mockStream,
      }),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toContain('no-cache')
    expect(response.headers.get('Cache-Control')).toContain('must-revalidate')
  })

  it('should return PNG buffer when screenshot exists (prod bucket)', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    const mockWebStream = new ReadableStream()
    const mockStream = {
      transformToWebStream: vi.fn().mockReturnValue(mockWebStream),
    }

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({
        Body: mockStream,
      }),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(prodUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
  })

  it('should use bucket from EVAL_SNAPSHOTS_BUCKET env var', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    const mockWebStream = new ReadableStream()
    const mockStream = {
      transformToWebStream: vi.fn().mockReturnValue(mockWebStream),
    }

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({ Body: mockStream }),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(200)
  })

  it('should throw error when EVAL_SNAPSHOTS_BUCKET env var is not set', async () => {
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', undefined)

    vi.resetModules()

    const { S3Client } = await import('@aws-sdk/client-s3')

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn(),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })

    await expect(
      GET(request, { params: Promise.resolve({ appId: mockAppId }) })
    ).rejects.toThrow('EVAL_SNAPSHOTS_BUCKET environment variable is not set')

    vi.unstubAllEnvs()
  })

  it('should set correct Content-Disposition header', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    const mockWebStream = new ReadableStream()
    const mockStream = {
      transformToWebStream: vi.fn().mockReturnValue(mockWebStream),
    }

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({ Body: mockStream }),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.headers.get('Content-Disposition')).toContain('inline')
    expect(response.headers.get('Content-Disposition')).toContain(mockAppId)
  })

  it('should handle falsy Body in S3 response', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')

    ;(S3Client as any).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({
        Body: null,
      }),
    }))

    const { GET } = await import('../route')

    const request = new NextRequest(new URL(devUrl), { method: 'GET' })
    const response = await GET(request, { params: Promise.resolve({ appId: mockAppId }) })

    expect(response.status).toBe(404)
  })
})
