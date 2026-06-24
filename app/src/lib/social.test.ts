import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FacebookMediaType, SocialPlatform } from '@/types/social'
import { SocialV2Client } from './social'

global.fetch = vi.fn()

const MAX_RETRY_ATTEMPTS = 3

const MOCK_IDS = {
  page: 'page-123',
  photo: '1337055138464295',
  post: 'page-123_post-456',
  container: 'container-123',
  igAccount: 'ig-123',
  igMedia: '17890123456789',
} as const

const MOCK_TOKENS = {
  user: 'test-token-123',
  page: 'token-456',
} as const

const MOCK_URLS = {
  image: 'https://example.com/image.jpg',
  facebookPhoto: 'https://www.facebook.com/photo.php?fbid=1337055138464295',
  facebookPost: 'https://www.facebook.com/page-123/posts/456',
  instagramPost: 'https://www.instagram.com/p/ABC123/',
  relativePhoto: '/photo.php?fbid=123',
} as const

const MOCK_MESSAGES = {
  default: 'Test post',
  scheduled: 'Scheduled post',
} as const

function mockResponse(data: Record<string, unknown>): Response {
  return { ok: true, json: async () => data } as Response
}

function mockErrorResponse(status: number, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  } as Response
}

function mockFailedResponse(status = 500): Response {
  return { ok: false, status } as Response
}

function createPermalinkPayload(overrides?: {
  mediaId?: string
  tokenId?: string
  platform?: SocialPlatform.FACEBOOK | SocialPlatform.INSTAGRAM
  mediaType?: FacebookMediaType
}) {
  return {
    mediaId: MOCK_IDS.photo,
    tokenId: MOCK_TOKENS.user,
    platform: SocialPlatform.FACEBOOK as SocialPlatform.FACEBOOK | SocialPlatform.INSTAGRAM,
    ...overrides,
  }
}

function createFacebookPayload(overrides?: {
  pageId?: string
  tokenId?: string
  message?: string
  imageUrls?: string[]
  scheduledAt?: Date
}) {
  return {
    pageId: MOCK_IDS.page,
    tokenId: MOCK_TOKENS.page,
    message: MOCK_MESSAGES.default,
    imageUrls: [MOCK_URLS.image],
    ...overrides,
  }
}

function createInstagramPayload(overrides?: {
  igAccountId?: string
  tokenId?: string
  imageUrl?: string
  caption?: string
  scheduledAt?: Date
}) {
  return {
    igAccountId: MOCK_IDS.igAccount,
    tokenId: MOCK_TOKENS.page,
    imageUrl: MOCK_URLS.image,
    caption: MOCK_MESSAGES.default,
    ...overrides,
  }
}

function getLastFetchUrl(): string {
  const calls = vi.mocked(fetch).mock.calls
  return calls[calls.length - 1][0] as string
}

function getFetchUrlAt(index: number): string {
  return vi.mocked(fetch).mock.calls[index][0] as string
}

function oneHourFromNow(): Date {
  return new Date(Date.now() + 3600000)
}

describe('SocialV2Client', () => {
  let client: SocialV2Client

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockReset()
    client = new SocialV2Client()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('fetchPermalink', () => {
    describe('Facebook photos', () => {
      it('uses "link" field (not permalink_url)', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ link: MOCK_URLS.facebookPhoto })
        )

        const result = await client.fetchPermalink(createPermalinkPayload())

        expect(result).toBe(MOCK_URLS.facebookPhoto)
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/${MOCK_IDS.photo}?fields=link`),
          expect.objectContaining({
            headers: expect.objectContaining({ 'X-Token-Id': MOCK_TOKENS.user }),
          })
        )
      })

      it('converts relative URLs to absolute URLs', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ link: MOCK_URLS.relativePhoto })
        )

        const result = await client.fetchPermalink(createPermalinkPayload({ mediaId: '123' }))

        expect(result).toBe('https://www.facebook.com/photo.php?fbid=123')
      })

      it('keeps absolute URLs unchanged', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ link: MOCK_URLS.facebookPhoto })
        )

        const result = await client.fetchPermalink(createPermalinkPayload({ mediaId: '123' }))

        expect(result).toBe(MOCK_URLS.facebookPhoto)
      })
    })

    describe('Instagram posts', () => {
      it('uses "permalink" field', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ permalink: MOCK_URLS.instagramPost })
        )

        const result = await client.fetchPermalink(
          createPermalinkPayload({
            mediaId: MOCK_IDS.igMedia,
            platform: SocialPlatform.INSTAGRAM,
          })
        )

        expect(result).toBe(MOCK_URLS.instagramPost)
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/${MOCK_IDS.igMedia}?fields=permalink`),
          expect.any(Object)
        )
      })
    })

    describe('retry behavior', () => {
      it('returns permalink on first successful attempt', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ link: MOCK_URLS.facebookPhoto })
        )

        const result = await client.fetchPermalink(createPermalinkPayload())

        expect(result).toBe(MOCK_URLS.facebookPhoto)
        expect(fetch).toHaveBeenCalledTimes(1)
      })

      it('retries and succeeds on third attempt', async () => {
        vi.useFakeTimers()
        vi.mocked(fetch)
          .mockResolvedValueOnce(mockResponse({}))
          .mockResolvedValueOnce(mockResponse({}))
          .mockResolvedValueOnce(mockResponse({ link: MOCK_URLS.facebookPhoto }))

        const promise = client.fetchPermalink(createPermalinkPayload())
        await vi.advanceTimersByTimeAsync(10000)
        const result = await promise

        expect(result).toBe(MOCK_URLS.facebookPhoto)
        expect(fetch).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS)
        vi.useRealTimers()
      })

    })

    describe('mediaType parameter', () => {
      it('uses "link" for photos', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ link: MOCK_URLS.facebookPhoto })
        )

        await client.fetchPermalink(createPermalinkPayload({ mediaType: FacebookMediaType.PHOTO }))

        expect(getLastFetchUrl()).toContain('fields=link')
      })

      it('uses "permalink_url" for posts', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ permalink_url: MOCK_URLS.facebookPost })
        )

        await client.fetchPermalink(
          createPermalinkPayload({ mediaId: MOCK_IDS.post, mediaType: FacebookMediaType.POST })
        )

        expect(getLastFetchUrl()).toContain('fields=permalink_url')
      })

      it('defaults to "link" when mediaType not specified', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ link: MOCK_URLS.facebookPhoto })
        )

        await client.fetchPermalink(createPermalinkPayload())

        expect(getLastFetchUrl()).toContain('fields=link')
      })
    })
  })

  describe('publishToFacebook', () => {
    describe('photo posts', () => {
      it('uses /photos endpoint and fetches permalink_url using post_id', async () => {
        vi.mocked(fetch)
          .mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.photo, post_id: MOCK_IDS.post }))
          .mockResolvedValueOnce(mockResponse({ permalink_url: MOCK_URLS.facebookPost }))

        const result = await client.publishToFacebook(createFacebookPayload())

        expect(result.id).toBe(MOCK_IDS.photo)
        expect(result.platformUrl).toBe(MOCK_URLS.facebookPost)
        expect(getFetchUrlAt(0)).toContain('/photos')
        expect(getFetchUrlAt(1)).toContain('fields=permalink_url')
        expect(getFetchUrlAt(1)).toContain(MOCK_IDS.post)
      })

      it('skips permalink fetch for scheduled posts', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.photo }))

        const result = await client.publishToFacebook(
          createFacebookPayload({ scheduledAt: oneHourFromNow() })
        )

        expect(result.platformUrl).toBeUndefined()
        expect(fetch).toHaveBeenCalledTimes(1)
      })
    })

    describe('text posts', () => {
      it('uses /feed endpoint and fetches permalink_url', async () => {
        vi.mocked(fetch)
          .mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.post }))
          .mockResolvedValueOnce(mockResponse({ permalink_url: MOCK_URLS.facebookPost }))

        const result = await client.publishToFacebook(
          createFacebookPayload({ imageUrls: [], message: 'Text only post' })
        )

        expect(result.id).toBe(MOCK_IDS.post)
        expect(result.platformUrl).toBe(MOCK_URLS.facebookPost)
        expect(getFetchUrlAt(0)).toContain('/feed')
        expect(getFetchUrlAt(0)).not.toContain('/photos')
        expect(getFetchUrlAt(1)).toContain('fields=permalink_url')
      })

      it('skips permalink fetch for scheduled posts', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.post }))

        const result = await client.publishToFacebook(
          createFacebookPayload({ imageUrls: [], scheduledAt: oneHourFromNow() })
        )

        expect(result.platformUrl).toBeUndefined()
        expect(fetch).toHaveBeenCalledTimes(1)
      })
    })

    describe('error handling', () => {
      it('throws on publish failure', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockErrorResponse(400, 'Invalid image URL'))

        await expect(
          client.publishToFacebook(createFacebookPayload({ imageUrls: ['invalid-url'] }))
        ).rejects.toThrow('Invalid image URL')
      })

      it('returns result without platformUrl if permalink fetch fails', async () => {
        vi.useFakeTimers()
        vi.mocked(fetch)
          .mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.photo }))
          .mockResolvedValue(mockFailedResponse())

        const promise = client.publishToFacebook(createFacebookPayload())
        await vi.advanceTimersByTimeAsync(10000)
        const result = await promise

        expect(result.id).toBe(MOCK_IDS.photo)
        expect(result.platformUrl).toBeUndefined()
        vi.useRealTimers()
      })
    })
  })

  describe('publishToInstagram', () => {
    it('creates container, publishes, and fetches permalink', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.container }))
        .mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.post }))
        .mockResolvedValueOnce(mockResponse({ permalink: MOCK_URLS.instagramPost }))

      const result = await client.publishToInstagram(createInstagramPayload())

      expect(result.id).toBe(MOCK_IDS.post)
      expect(result.platformUrl).toBe(MOCK_URLS.instagramPost)
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('throws on container creation failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockErrorResponse(400, 'Invalid image format'))

      await expect(
        client.publishToInstagram(createInstagramPayload({ imageUrl: 'https://example.com/bad.txt' }))
      ).rejects.toThrow('Invalid image format')
    })

    it('throws on publish failure after container creation', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockResponse({ id: MOCK_IDS.container }))
        .mockResolvedValueOnce(mockErrorResponse(400, 'Container not ready'))

      await expect(client.publishToInstagram(createInstagramPayload())).rejects.toThrow(
        'Container not ready'
      )
    })
  })

  describe('getGoogleReviews', () => {
    const MOCK_ACCOUNT_ID = 'acc-12345'
    const MOCK_LOCATION_ID = 'loc-67890'

    it('uses mybusiness v4 endpoint (not mybusinessreviews)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ reviews: [] }))

      await client.getGoogleReviews(MOCK_TOKENS.user, MOCK_ACCOUNT_ID, MOCK_LOCATION_ID)

      const url = getLastFetchUrl()
      expect(url).toContain('/mybusiness/v4/')
      expect(url).not.toContain('mybusinessreviews')
    })

    it('places accountId and locationId in the correct URL segments', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ reviews: [] }))

      await client.getGoogleReviews(MOCK_TOKENS.user, MOCK_ACCOUNT_ID, MOCK_LOCATION_ID)

      expect(getLastFetchUrl()).toContain(
        `/accounts/${MOCK_ACCOUNT_ID}/locations/${MOCK_LOCATION_ID}/reviews`
      )
    })

    it('includes pageSize query param', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ reviews: [] }))

      await client.getGoogleReviews(MOCK_TOKENS.user, MOCK_ACCOUNT_ID, MOCK_LOCATION_ID, 5)

      expect(getLastFetchUrl()).toContain('pageSize=5')
    })

    it('returns the reviews array from the response', async () => {
      const mockReviews = [{ reviewId: 'r1' }, { reviewId: 'r2' }]
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ reviews: mockReviews }))

      const result = await client.getGoogleReviews(MOCK_TOKENS.user, MOCK_ACCOUNT_ID, MOCK_LOCATION_ID)

      expect(result).toEqual(mockReviews)
    })

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(401))

      await expect(
        client.getGoogleReviews(MOCK_TOKENS.user, MOCK_ACCOUNT_ID, MOCK_LOCATION_ID)
      ).rejects.toThrow('Failed to fetch Google reviews: 401')
    })

    it('throws when response body has no reviews array', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ data: [] }))

      await expect(
        client.getGoogleReviews(MOCK_TOKENS.user, MOCK_ACCOUNT_ID, MOCK_LOCATION_ID)
      ).rejects.toThrow('Unexpected response shape')
    })
  })

  describe('getGoogleBusinessProfile', () => {
    const MOCK_LOCATION_ID = 'loc-67890'

    it('maps a fully-populated location to the GoogleBusinessProfile shape', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          title: 'Acme Plumbing',
          storefrontAddress: { addressLines: ['123 Main St'], locality: 'Phoenix' },
          phoneNumbers: { primaryPhone: '(555) 123-4567' },
          regularHours: { periods: [{ openDay: 'MONDAY' }] },
          websiteUri: 'https://acme.example',
          profile: { description: 'Family-owned since 1990' },
        })
      )

      const result = await client.getGoogleBusinessProfile(MOCK_TOKENS.user, MOCK_LOCATION_ID)

      expect(result).toEqual({
        name: 'Acme Plumbing',
        storefrontAddress: { addressLines: ['123 Main St'], locality: 'Phoenix' },
        primaryPhone: '(555) 123-4567',
        regularHours: { periods: [{ openDay: 'MONDAY' }] },
        websiteUri: 'https://acme.example',
        description: 'Family-owned since 1990',
      })
    })

    it('reads the single-location Business Information endpoint by locationId', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ title: 'X' }))

      await client.getGoogleBusinessProfile(MOCK_TOKENS.user, MOCK_LOCATION_ID)

      expect(getLastFetchUrl()).toContain(`/mybusinessbusinessinformation/v1/locations/${MOCK_LOCATION_ID}`)
    })

    it('defaults missing title to "" and yields undefined for missing phoneNumbers/profile (no throw)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ websiteUri: 'https://x.example' }))

      const result = await client.getGoogleBusinessProfile(MOCK_TOKENS.user, MOCK_LOCATION_ID)

      expect(result.name).toBe('')
      expect(result.primaryPhone).toBeUndefined()
      expect(result.description).toBeUndefined()
      expect(result.websiteUri).toBe('https://x.example')
    })

    it('throws on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(503))

      await expect(
        client.getGoogleBusinessProfile(MOCK_TOKENS.user, MOCK_LOCATION_ID)
      ).rejects.toThrow('Failed to fetch Google Business Profile: 503')
    })
  })

  describe('regression: Facebook Photo permalink_url error', () => {
    it('does NOT request permalink_url for photos', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ link: MOCK_URLS.facebookPhoto }))

      await client.fetchPermalink(createPermalinkPayload({ mediaType: FacebookMediaType.PHOTO }))

      const url = getLastFetchUrl()
      expect(url).toContain('?fields=link')
      expect(url).not.toContain('permalink_url')
    })

    it('handles API error for wrong field gracefully', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: '(#100) Tried accessing nonexisting field (permalink_url) on node type (Photo)',
            type: 'OAuthException',
            code: 100,
          },
        }),
      } as Response)

      const promise = client.fetchPermalink(
        createPermalinkPayload({ mediaType: FacebookMediaType.PHOTO })
      )
      await vi.advanceTimersByTimeAsync(10000)
      const result = await promise

      expect(result).toBeNull()
      vi.useRealTimers()
    })
  })
})
