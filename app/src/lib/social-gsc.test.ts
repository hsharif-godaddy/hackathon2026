import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GscClient } from './social-gsc'

global.fetch = vi.fn()

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({ logger: mockLogger }))
vi.mock('@/utils/getRootDomain', () => ({ getRootDomain: () => 'godaddy.com' }))

const TOKEN_ID = 'Platform#GOOGLE#TokenType#USER#123'
const SITE_URL = 'https://example.godaddysites.com'
const SITE_URL_TRAILING = 'https://example.godaddysites.com/'

function okResponse(data: Record<string, unknown> = {}): Response {
  return { ok: true, status: 200, json: async () => data } as Response
}

function failResponse(status = 400): Response {
  return { ok: false, status } as Response
}

describe('GscClient', () => {
  let client: GscClient

  beforeEach(() => {
    client = new GscClient()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getGscVerificationToken', () => {
    it('extracts token from full meta tag format returned by social-auth', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        okResponse({ token: '<meta name="google-site-verification" content="CLdK-abc123" />' })
      )
      const result = await client.getGscVerificationToken(SITE_URL, TOKEN_ID)
      expect(result).toBe('CLdK-abc123')
    })

    it('extracts token from google-site-verification= prefix format', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        okResponse({ token: 'google-site-verification=CLdK-abc123' })
      )
      const result = await client.getGscVerificationToken(SITE_URL, TOKEN_ID)
      expect(result).toBe('CLdK-abc123')
    })

    it('returns bare token unchanged when no prefix or meta tag', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse({ token: 'CLdK-abc123' }))
      const result = await client.getGscVerificationToken(SITE_URL, TOKEN_ID)
      expect(result).toBe('CLdK-abc123')
    })

    it('appends trailing slash to siteUrl in request body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse({ token: 'CLdK-abc123' }))
      await client.getGscVerificationToken(SITE_URL, TOKEN_ID)
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(body.site.identifier).toBe(SITE_URL_TRAILING)
    })

    it('does not double-append trailing slash', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse({ token: 'CLdK-abc123' }))
      await client.getGscVerificationToken(SITE_URL_TRAILING, TOKEN_ID)
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(body.site.identifier).toBe(SITE_URL_TRAILING)
    })

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(failResponse(403))
      await expect(client.getGscVerificationToken(SITE_URL, TOKEN_ID)).rejects.toThrow('403')
    })
  })

  describe('verifyGscSite', () => {
    it('succeeds on first attempt without delay', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse())
      await client.verifyGscSite(SITE_URL, TOKEN_ID)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(mockLogger.info).toHaveBeenCalledWith('gsc.verify.success', { attempt: 1 })
    })

    it('retries on failure and succeeds on second attempt', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse(400))
        .mockResolvedValueOnce(okResponse())

      const promise = client.verifyGscSite(SITE_URL, TOKEN_ID)
      await vi.advanceTimersByTimeAsync(3000)
      await promise

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(mockLogger.warn).toHaveBeenCalledWith('gsc.verify.attempt-failed', expect.objectContaining({ attempt: 1 }))
      expect(mockLogger.info).toHaveBeenCalledWith('gsc.verify.success', { attempt: 2 })
    })

    it('throws after exhausting all retries and logs each failure', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockResolvedValue(failResponse(400))

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const assertion = expect(client.verifyGscSite(SITE_URL, TOKEN_ID)).rejects.toThrow('after 3 attempts')
      await vi.advanceTimersByTimeAsync(10000)
      await assertion

      expect(fetch).toHaveBeenCalledTimes(3)
      expect(mockLogger.warn).toHaveBeenCalledTimes(3)
    })

    it('normalizes siteUrl to include trailing slash', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse())
      await client.verifyGscSite(SITE_URL, TOKEN_ID)
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(body.site.identifier).toBe(SITE_URL_TRAILING)
    })
  })

  describe('addGscSite', () => {
    it('calls PUT with trailing-slash-normalized encoded site URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse())
      const result = await client.addGscSite(SITE_URL, TOKEN_ID)
      const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain(encodeURIComponent(SITE_URL_TRAILING))
      expect(opts.method).toBe('PUT')
      expect(result).toBe(true)
    })

    it('normalizes siteUrl to include trailing slash', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse())
      await client.addGscSite(SITE_URL, TOKEN_ID)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain(encodeURIComponent(SITE_URL_TRAILING))
      expect(url).not.toContain(encodeURIComponent(SITE_URL + '/extra'))
    })

    it('returns false and logs after exhausting all retries', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockResolvedValue(failResponse(403))

      const promise = client.addGscSite(SITE_URL, TOKEN_ID)
      await vi.advanceTimersByTimeAsync(10000)
      const result = await promise

      expect(result).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(mockLogger.warn).toHaveBeenCalledWith('gsc.add-site.attempt-failed', expect.objectContaining({ attempt: 1, status: 403 }))
      expect(mockLogger.warn).toHaveBeenCalledWith('gsc.add-site.attempt-failed', expect.objectContaining({ attempt: 3, status: 403 }))
      expect(mockLogger.warn).toHaveBeenCalledWith('gsc.add-site.exhausted', expect.objectContaining({ siteUrl: SITE_URL_TRAILING }))
    })

    it('retries on failure and returns true on second attempt', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse(503))
        .mockResolvedValueOnce(okResponse())

      const promise = client.addGscSite(SITE_URL, TOKEN_ID)
      await vi.advanceTimersByTimeAsync(3000)
      const result = await promise

      expect(result).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(mockLogger.info).toHaveBeenCalledWith('gsc.add-site.success', { attempt: 2 })
    })
  })

  describe('submitGscSitemap', () => {
    it('constructs sitemap URL from site URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(okResponse())
      await client.submitGscSitemap(SITE_URL, TOKEN_ID)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain(encodeURIComponent(`${SITE_URL_TRAILING}sitemap.xml`))
    })

    it('throws on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(failResponse(500))
      await expect(client.submitGscSitemap(SITE_URL, TOKEN_ID)).rejects.toThrow('GSC sitemap submit failed')
    })
  })
})
