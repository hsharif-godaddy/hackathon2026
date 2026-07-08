import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FacebookMediaType,
  GoogleAdsAssetFieldType,
  GoogleAdsAssetType,
  GoogleAdsCampaignStatus,
  GoogleAdsConversionCategory,
  SocialPlatform,
} from '@/types/social'
import { SocialV2Client, validateCustomerId, validateResourceName } from './social'

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

  describe('Google Ads API', () => {
    const MOCK_GOOGLE_ADS = {
      userTokenId: 'token-google-ads-123',
      developerToken: 'dev-token-test-456',
      customerId: '1234567890',
      campaignId: '9876543210',
      assetGroupId: '1111111111',
      assetId: '2222222222',
      conversionActionId: '3333333333',
    } as const

    describe('listGoogleAdsCustomers', () => {
      it('calls the correct endpoint with POST method', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            resourceNames: [
              'customers/1234567890',
              'customers/9876543210',
            ],
          })
        )

        await client.listGoogleAdsCustomers(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken)

        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('/google/proxy/googleads/v22/customers:listAccessibleCustomers'),
          expect.objectContaining({
            method: 'POST',
            credentials: 'include',
            headers: expect.objectContaining({
              'X-Token-Id': MOCK_GOOGLE_ADS.userTokenId,
              'developer-token': MOCK_GOOGLE_ADS.developerToken,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            }),
          })
        )
      })

      it('extracts customer IDs from resource names', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            resourceNames: [
              'customers/1234567890',
              'customers/9876543210',
            ],
          })
        )

        const result = await client.listGoogleAdsCustomers(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken)

        expect(result).toEqual([
          { resourceName: 'customers/1234567890', id: '1234567890' },
          { resourceName: 'customers/9876543210', id: '9876543210' },
        ])
      })

      it('returns empty array when no resource names', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}))

        const result = await client.listGoogleAdsCustomers(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken)

        expect(result).toEqual([])
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(401))

        await expect(
          client.listGoogleAdsCustomers(MOCK_GOOGLE_ADS.userTokenId)
        ).rejects.toThrow('Failed to list Google Ads customers: 401')
      })
    })

    describe('getGoogleAdsCustomer', () => {
      it('sends GAQL query to search endpoint', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                customer: {
                  id: '1234567890',
                  resourceName: 'customers/1234567890',
                  descriptiveName: 'Test Account',
                  currencyCode: 'USD',
                  timeZone: 'America/Los_Angeles',
                  manager: false,
                },
              },
            ],
          })
        )

        await client.getGoogleAdsCustomer(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId)

        const callArgs = vi.mocked(fetch).mock.calls[0]
        expect(callArgs[0]).toContain(`/customers/${MOCK_GOOGLE_ADS.customerId}/googleAds:search`)
        expect(callArgs[1]).toMatchObject({
          method: 'POST',
          body: expect.stringContaining('SELECT'),
        })
      })

      it('returns customer details', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                customer: {
                  id: '1234567890',
                  resourceName: 'customers/1234567890',
                  descriptiveName: 'Test Account',
                  currencyCode: 'USD',
                  timeZone: 'America/Los_Angeles',
                  manager: true,
                },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsCustomer(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId
        )

        expect(result).toEqual({
          id: '1234567890',
          resourceName: 'customers/1234567890',
          descriptiveName: 'Test Account',
          currencyCode: 'USD',
          timeZone: 'America/Los_Angeles',
          manager: true,
        })
      })

      it('throws when customer not found', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ results: [] }))

        await expect(
          client.getGoogleAdsCustomer(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId)
        ).rejects.toThrow('Customer 1234567890 not found')
      })
    })

    describe('getGoogleAdsCampaigns', () => {
      it('queries Performance Max campaigns', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                campaign: {
                  id: '9876543210',
                  resourceName: 'customers/1234567890/campaigns/9876543210',
                  name: 'Test PMax Campaign',
                  status: 'ENABLED',
                  advertisingChannelType: 'PERFORMANCE_MAX',
                  biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
                  campaignBudget: 'customers/1234567890/campaignBudgets/111',
                  urlExpansionOptOut: false,
                  startDate: '2026-01-01',
                  endDate: '2026-12-31',
                },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsCampaigns(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId
        )

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          id: '9876543210',
          name: 'Test PMax Campaign',
          status: 'ENABLED',
          advertisingChannelType: 'PERFORMANCE_MAX',
        })
      })

      it('filters out REMOVED campaigns by default', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ results: [] }))

        await client.getGoogleAdsCampaigns(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId)

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.query).toContain("campaign.status != 'REMOVED'")
      })

      it('includes REMOVED campaigns when includeRemoved is true', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ results: [] }))

        await client.getGoogleAdsCampaigns(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          true
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.query).not.toContain("campaign.status != 'REMOVED'")
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(403))

        await expect(
          client.getGoogleAdsCampaigns(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId)
        ).rejects.toThrow('Failed to get Google Ads campaigns: 403')
      })
    })

    describe('createGoogleAdsCampaign', () => {
      it('creates budget first, then campaign', async () => {
        vi.mocked(fetch)
          .mockResolvedValueOnce(
            mockResponse({
              results: [{ resourceName: 'customers/1234567890/campaignBudgets/111' }],
            })
          )
          .mockResolvedValueOnce(
            mockResponse({
              results: [{ resourceName: 'customers/1234567890/campaigns/9876543210' }],
            })
          )

        const result = await client.createGoogleAdsCampaign(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            name: 'New Campaign',
            budgetAmountMicros: 10000000,
          }
        )

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(getFetchUrlAt(0)).toContain('/campaignBudgets:mutate')
        expect(getFetchUrlAt(1)).toContain('/campaigns:mutate')
        expect(result).toEqual({
          resourceName: 'customers/1234567890/campaigns/9876543210',
          campaignId: '9876543210',
        })
      })

      it('includes optional parameters when provided', async () => {
        vi.mocked(fetch)
          .mockResolvedValueOnce(
            mockResponse({
              results: [{ resourceName: 'customers/1234567890/campaignBudgets/111' }],
            })
          )
          .mockResolvedValueOnce(
            mockResponse({
              results: [{ resourceName: 'customers/1234567890/campaigns/9876543210' }],
            })
          )

        await client.createGoogleAdsCampaign(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
          name: 'New Campaign',
          budgetAmountMicros: 10000000,
          biddingStrategy: 'TARGET_ROAS',
          targetRoas: 4.5,
          startDate: '2026-07-01',
          endDate: '2026-12-31',
        })

        const campaignBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)
        expect(campaignBody.operations[0].create).toMatchObject({
          name: 'New Campaign',
          biddingStrategyType: 'TARGET_ROAS',
          targetRoas: 4.5,
          startDate: '2026-07-01',
          endDate: '2026-12-31',
        })
      })

      it('throws on budget creation failure', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(400))

        await expect(
          client.createGoogleAdsCampaign(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
            name: 'New Campaign',
            budgetAmountMicros: 10000000,
          })
        ).rejects.toThrow('Failed to create campaign budget: 400')
      })

      it('throws when budget resource name is missing (orphaned budget concern)', async () => {
        // Budget "succeeds" but returns empty response
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ results: [{}] })
        )

        await expect(
          client.createGoogleAdsCampaign(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
            name: 'New Campaign',
            budgetAmountMicros: 10000000,
          })
        ).rejects.toThrow('Failed to create campaign budget: missing resource name in response')
      })

      it('throws when campaign creation fails after budget succeeds (orphaned budget)', async () => {
        // Step 1: Budget creation succeeds
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/campaignBudgets/99999' }],
          })
        )
        // Step 2: Campaign creation fails
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => 'Invalid campaign configuration',
        } as Response)

        await expect(
          client.createGoogleAdsCampaign(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
            name: 'New Campaign',
            budgetAmountMicros: 10000000,
          })
        ).rejects.toThrow('Failed to create Google Ads campaign: 400 - Invalid campaign configuration')

        // Verify budget was created (2 fetch calls)
        expect(fetch).toHaveBeenCalledTimes(2)
      })

      it('throws when campaign resource name is missing in response', async () => {
        // Budget succeeds
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/campaignBudgets/99999' }],
          })
        )
        // Campaign "succeeds" but returns empty response
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ results: [{}] })
        )

        await expect(
          client.createGoogleAdsCampaign(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
            name: 'New Campaign',
            budgetAmountMicros: 10000000,
          })
        ).rejects.toThrow('Failed to create campaign: missing resource name in response')
      })
    })

    describe('updateGoogleAdsCampaign', () => {
      it('sends update operation with updateMask', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}))

        await client.updateGoogleAdsCampaign(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          MOCK_GOOGLE_ADS.campaignId,
          { name: 'Updated Name', status: GoogleAdsCampaignStatus.PAUSED }
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0]).toMatchObject({
          update: {
            resourceName: `customers/${MOCK_GOOGLE_ADS.customerId}/campaigns/${MOCK_GOOGLE_ADS.campaignId}`,
            name: 'Updated Name',
            status: 'PAUSED',
          },
          updateMask: 'name,status',
        })
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => 'Invalid status',
        } as Response)

        await expect(
          client.updateGoogleAdsCampaign(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            MOCK_GOOGLE_ADS.campaignId,
            { status: GoogleAdsCampaignStatus.PAUSED }
          )
        ).rejects.toThrow('Failed to update Google Ads campaign: 400 - Invalid status')
      })
    })

    describe('deleteGoogleAdsCampaign', () => {
      it('sends remove operation', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}))

        await client.deleteGoogleAdsCampaign(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          MOCK_GOOGLE_ADS.campaignId
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0]).toEqual({
          remove: `customers/${MOCK_GOOGLE_ADS.customerId}/campaigns/${MOCK_GOOGLE_ADS.campaignId}`,
        })
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(403))

        await expect(
          client.deleteGoogleAdsCampaign(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            MOCK_GOOGLE_ADS.campaignId
          )
        ).rejects.toThrow('Failed to delete Google Ads campaign: 403')
      })
    })

    describe('getGoogleAdsAssetGroups', () => {
      it('queries asset groups for a campaign', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                assetGroup: {
                  id: '1111111111',
                  resourceName: 'customers/1234567890/assetGroups/1111111111',
                  campaign: 'customers/1234567890/campaigns/9876543210',
                  name: 'Asset Group 1',
                  status: 'ENABLED',
                  finalUrls: ['https://example.com'],
                  finalMobileUrls: ['https://m.example.com'],
                },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsAssetGroups(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          MOCK_GOOGLE_ADS.campaignId
        )

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          id: '1111111111',
          name: 'Asset Group 1',
          status: 'ENABLED',
          finalUrls: ['https://example.com'],
        })
      })

      it('filters by campaign resource name in query', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ results: [] }))

        await client.getGoogleAdsAssetGroups(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          MOCK_GOOGLE_ADS.campaignId
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.query).toContain(
          `asset_group.campaign = 'customers/${MOCK_GOOGLE_ADS.customerId}/campaigns/${MOCK_GOOGLE_ADS.campaignId}'`
        )
      })
    })

    describe('createGoogleAdsAssetGroup', () => {
      it('creates asset group with required fields', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/assetGroups/1111111111' }],
          })
        )

        const result = await client.createGoogleAdsAssetGroup(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            campaignId: MOCK_GOOGLE_ADS.campaignId,
            name: 'New Asset Group',
            finalUrls: ['https://example.com'],
          }
        )

        expect(result).toEqual({
          resourceName: 'customers/1234567890/assetGroups/1111111111',
          assetGroupId: '1111111111',
        })

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create).toMatchObject({
          name: 'New Asset Group',
          campaign: `customers/${MOCK_GOOGLE_ADS.customerId}/campaigns/${MOCK_GOOGLE_ADS.campaignId}`,
          finalUrls: ['https://example.com'],
          status: 'ENABLED',
        })
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => 'Permission denied',
        } as Response)

        await expect(
          client.createGoogleAdsAssetGroup(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              campaignId: MOCK_GOOGLE_ADS.campaignId,
              name: 'New Asset Group',
              finalUrls: ['https://example.com'],
            }
          )
        ).rejects.toThrow('Failed to create Google Ads asset group: 403 - Permission denied')
      })

      it('throws when resource name is missing in response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ results: [{}] })
        )

        await expect(
          client.createGoogleAdsAssetGroup(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              campaignId: MOCK_GOOGLE_ADS.campaignId,
              name: 'New Asset Group',
              finalUrls: ['https://example.com'],
            }
          )
        ).rejects.toThrow('Failed to create asset group: missing resource name in response')
      })

      it('includes optional mobile URLs when provided', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/assetGroups/1111111111' }],
          })
        )

        await client.createGoogleAdsAssetGroup(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
          campaignId: MOCK_GOOGLE_ADS.campaignId,
          name: 'New Asset Group',
          finalUrls: ['https://example.com'],
          finalMobileUrls: ['https://m.example.com'],
        })

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create.finalMobileUrls).toEqual(['https://m.example.com'])
      })
    })

    describe('uploadGoogleAdsAsset', () => {
      it('uploads IMAGE asset with base64 data', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/assets/2222222222' }],
          })
        )

        const result = await client.uploadGoogleAdsAsset(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            type: GoogleAdsAssetType.IMAGE,
            name: 'Marketing Image',
            imageData: 'base64encodeddata',
          }
        )

        expect(result).toEqual({
          resourceName: 'customers/1234567890/assets/2222222222',
          assetId: '2222222222',
        })

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create).toMatchObject({
          name: 'Marketing Image',
          type: 'IMAGE',
          imageAsset: { data: 'base64encodeddata' },
        })
      })

      it('uploads TEXT asset', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/assets/2222222222' }],
          })
        )

        await client.uploadGoogleAdsAsset(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
          type: GoogleAdsAssetType.TEXT,
          text: 'Headline text',
        })

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create).toMatchObject({
          type: 'TEXT',
          textAsset: { text: 'Headline text' },
        })
      })

      it('uploads VIDEO asset with YouTube video ID', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [{ resourceName: 'customers/1234567890/assets/2222222222' }],
          })
        )

        await client.uploadGoogleAdsAsset(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
          type: GoogleAdsAssetType.VIDEO,
          youtubeVideoId: 'dQw4w9WgXcQ',
        })

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create).toMatchObject({
          type: 'VIDEO',
          youtubeVideoAsset: { youtubeVideoId: 'dQw4w9WgXcQ' },
        })
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => 'Invalid asset data',
        } as Response)

        await expect(
          client.uploadGoogleAdsAsset(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
            type: GoogleAdsAssetType.IMAGE,
            imageData: 'base64data',
          })
        ).rejects.toThrow('Failed to upload Google Ads asset: 400 - Invalid asset data')
      })

      it('throws when resource name is missing in response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ results: [{}] })
        )

        await expect(
          client.uploadGoogleAdsAsset(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId, {
            type: GoogleAdsAssetType.IMAGE,
            imageData: 'base64data',
          })
        ).rejects.toThrow('Failed to upload asset: missing resource name in response')
      })
    })

    describe('linkGoogleAdsAssetToGroup', () => {
      it('creates asset group asset link', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}))

        await client.linkGoogleAdsAssetToGroup(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            assetGroupId: MOCK_GOOGLE_ADS.assetGroupId,
            assetId: MOCK_GOOGLE_ADS.assetId,
            fieldType: GoogleAdsAssetFieldType.HEADLINE,
          }
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create).toEqual({
          assetGroup: `customers/${MOCK_GOOGLE_ADS.customerId}/assetGroups/${MOCK_GOOGLE_ADS.assetGroupId}`,
          asset: `customers/${MOCK_GOOGLE_ADS.customerId}/assets/${MOCK_GOOGLE_ADS.assetId}`,
          fieldType: 'HEADLINE',
        })

        expect(getLastFetchUrl()).toContain('/assetGroupAssets:mutate')
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Asset not found',
        } as Response)

        await expect(
          client.linkGoogleAdsAssetToGroup(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              assetGroupId: MOCK_GOOGLE_ADS.assetGroupId,
              assetId: MOCK_GOOGLE_ADS.assetId,
              fieldType: GoogleAdsAssetFieldType.HEADLINE,
            }
          )
        ).rejects.toThrow('Failed to link asset to group: 404 - Asset not found')
      })

      it('throws when asset group ID is non-numeric', async () => {
        await expect(
          client.linkGoogleAdsAssetToGroup(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              assetGroupId: 'abc',
              assetId: MOCK_GOOGLE_ADS.assetId,
              fieldType: GoogleAdsAssetFieldType.HEADLINE,
            }
          )
        ).rejects.toThrow('Invalid asset group ID format')
        expect(fetch).not.toHaveBeenCalled()
      })

      it('throws when asset ID is non-numeric', async () => {
        await expect(
          client.linkGoogleAdsAssetToGroup(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              assetGroupId: MOCK_GOOGLE_ADS.assetGroupId,
              assetId: 'abc',
              fieldType: GoogleAdsAssetFieldType.HEADLINE,
            }
          )
        ).rejects.toThrow('Invalid asset ID format')
        expect(fetch).not.toHaveBeenCalled()
      })
    })

    describe('getGoogleAdsCampaignMetrics', () => {
      it('queries campaign metrics with date range', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                campaign: { id: '9876543210', name: 'Test Campaign' },
                metrics: {
                  impressions: 1000,
                  clicks: 50,
                  costMicros: 5000000,
                  conversions: 5,
                  conversionsValue: 500,
                  averageCpc: 100000,
                  ctr: 0.05,
                },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsCampaignMetrics(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          }
        )

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          campaignId: '9876543210',
          campaignName: 'Test Campaign',
          impressions: 1000,
          clicks: 50,
          costMicros: 5000000,
          conversions: 5,
          conversionValue: 500,
          dateRange: {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          },
        })
      })

      it('calculates averages correctly', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                campaign: { id: '1', name: 'Campaign 1' },
                metrics: {
                  impressions: 1000,
                  clicks: 100,
                  costMicros: 10000000,
                  conversions: 0,
                  conversionsValue: 0,
                },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsCampaignMetrics(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          }
        )

        expect(result[0].averageCpc).toBe(100000) // 10000000 / 100
        expect(result[0].ctr).toBe(0.1) // 100 / 1000
      })

      it('filters by campaign IDs when provided', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ results: [] }))

        await client.getGoogleAdsCampaignMetrics(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            campaignIds: ['111', '222'],
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          }
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.query).toContain('AND campaign.id IN (111,222)')
      })

      it('aggregates metrics across multiple result rows', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                campaign: { id: '1', name: 'Campaign 1' },
                metrics: { impressions: 500, clicks: 25, costMicros: 2500000, conversions: 2, conversionsValue: 200 },
              },
              {
                campaign: { id: '1', name: 'Campaign 1' },
                metrics: { impressions: 500, clicks: 25, costMicros: 2500000, conversions: 3, conversionsValue: 300 },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsCampaignMetrics(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            startDate: '2026-06-01',
            endDate: '2026-06-30',
          }
        )

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          impressions: 1000,
          clicks: 50,
          costMicros: 5000000,
          conversions: 5,
          conversionValue: 500,
        })
      })
    })

    describe('getGoogleAdsConversionActions', () => {
      it('queries conversion actions', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                conversionAction: {
                  id: '3333333333',
                  resourceName: 'customers/1234567890/conversionActions/3333333333',
                  name: 'Purchase',
                  status: 'ENABLED',
                  category: 'PURCHASE',
                  type: 'WEBPAGE',
                  countingType: 'ONE_PER_CLICK',
                  valueSettings: { defaultValue: 50000000 },
                  clickThroughLookbackWindowDays: 30,
                },
              },
            ],
          })
        )

        const result = await client.getGoogleAdsConversionActions(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId
        )

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          id: '3333333333',
          name: 'Purchase',
          category: 'PURCHASE',
          type: 'WEBPAGE',
          countingType: 'ONE_PER_CLICK',
          valueMicros: 50000000,
        })
      })

      it('returns empty array when results is empty', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ results: [] }))

        const result = await client.getGoogleAdsConversionActions(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId
        )

        expect(result).toEqual([])
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockFailedResponse(401))

        await expect(
          client.getGoogleAdsConversionActions(MOCK_GOOGLE_ADS.userTokenId, MOCK_GOOGLE_ADS.developerToken, MOCK_GOOGLE_ADS.customerId)
        ).rejects.toThrow('Failed to get conversion actions: 401')
      })
    })

    describe('createGoogleAdsConversionAction', () => {
      it('creates conversion action with tag snippets', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                resourceName: 'customers/1234567890/conversionActions/3333333333',
                tagSnippets: {
                  globalSiteTag: '<script>gtag...</script>',
                  eventSnippet: '<script>gtag("event"...</script>',
                },
              },
            ],
          })
        )

        const result = await client.createGoogleAdsConversionAction(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            name: 'Purchase',
            category: GoogleAdsConversionCategory.PURCHASE,
            valueMicros: 50000000,
            countingType: 'ONE_PER_CLICK',
          }
        )

        expect(result).toEqual({
          resourceName: 'customers/1234567890/conversionActions/3333333333',
          conversionActionId: '3333333333',
          tagSnippets: {
            globalSiteTag: '<script>gtag...</script>',
            eventSnippet: '<script>gtag("event"...</script>',
          },
        })

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create).toMatchObject({
          name: 'Purchase',
          category: 'PURCHASE',
          type: 'WEBPAGE',
          status: 'ENABLED',
          countingType: 'ONE_PER_CLICK',
          valueSettings: {
            defaultValue: 50000000,
            alwaysUseDefaultValue: true,
          },
        })
      })

      it('uses default counting type when not provided', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                resourceName: 'customers/1234567890/conversionActions/3333333333',
                tagSnippets: {
                  globalSiteTag: '<script>gtag...</script>',
                  eventSnippet: '<script>gtag("event"...</script>',
                },
              },
            ],
          })
        )

        await client.createGoogleAdsConversionAction(
          MOCK_GOOGLE_ADS.userTokenId,
          MOCK_GOOGLE_ADS.developerToken,
          MOCK_GOOGLE_ADS.customerId,
          {
            name: 'Lead',
            category: GoogleAdsConversionCategory.LEAD,
          }
        )

        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
        expect(body.operations[0].create.countingType).toBe('ONE_PER_CLICK')
      })

      it('throws on non-ok response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => 'Invalid conversion action',
        } as Response)

        await expect(
          client.createGoogleAdsConversionAction(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              name: 'Purchase',
              category: GoogleAdsConversionCategory.PURCHASE,
            }
          )
        ).rejects.toThrow('Failed to create conversion action: 400 - Invalid conversion action')
      })

      it('throws when resource name is missing in response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({ results: [{}] })
        )

        await expect(
          client.createGoogleAdsConversionAction(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              name: 'Purchase',
              category: GoogleAdsConversionCategory.PURCHASE,
            }
          )
        ).rejects.toThrow('Failed to create conversion action: missing resource name in response')
      })

      it('throws when tag snippets are missing in response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
          mockResponse({
            results: [
              {
                resourceName: 'customers/1234567890/conversionActions/3333333333',
                tagSnippets: {
                  globalSiteTag: '<script>gtag...</script>',
                  // eventSnippet missing
                },
              },
            ],
          })
        )

        await expect(
          client.createGoogleAdsConversionAction(
            MOCK_GOOGLE_ADS.userTokenId,
            MOCK_GOOGLE_ADS.developerToken,
            MOCK_GOOGLE_ADS.customerId,
            {
              name: 'Purchase',
              category: GoogleAdsConversionCategory.PURCHASE,
            }
          )
        ).rejects.toThrow('Failed to create conversion action: missing tag snippets in response')
      })
    })

    describe('input validation guards', () => {
      describe('validateCustomerId', () => {
        it('throws on non-numeric input', () => {
          expect(() => validateCustomerId('abc')).toThrow('Invalid Google Ads customer ID format')
        })

        it('throws on empty string', () => {
          expect(() => validateCustomerId('')).toThrow('Invalid Google Ads customer ID format')
        })

        it('throws when fewer than 10 digits', () => {
          expect(() => validateCustomerId('12345')).toThrow('Invalid Google Ads customer ID format')
        })

        it('throws when more than 10 digits', () => {
          expect(() => validateCustomerId('12345678901')).toThrow('Invalid Google Ads customer ID format')
        })

        it('strips non-digit characters before validating', () => {
          expect(validateCustomerId('123-456-7890')).toBe('1234567890')
        })

        it('returns the sanitized ID for a valid 10-digit input', () => {
          expect(validateCustomerId('1234567890')).toBe('1234567890')
        })
      })

      describe('validateResourceName', () => {
        it('throws on path-traversal input', () => {
          expect(() => validateResourceName('../../etc/passwd')).toThrow('Invalid Google Ads resource name format')
        })

        it('throws when the id segment contains letters', () => {
          expect(() => validateResourceName('customers/abc')).toThrow('Invalid Google Ads resource name format')
        })

        it('throws when there is only one segment (no slash)', () => {
          expect(() => validateResourceName('customers')).toThrow('Invalid Google Ads resource name format')
        })

        it('throws on an odd number of segments', () => {
          expect(() => validateResourceName('customers/1234567890/campaigns')).toThrow('Invalid Google Ads resource name format')
        })

        it('throws when type segment contains uppercase letters', () => {
          expect(() => validateResourceName('CUSTOMERS/1234567890')).toThrow('Invalid Google Ads resource name format')
        })

        it('throws when the type segment is empty', () => {
          expect(() => validateResourceName('/1234567890')).toThrow('Invalid Google Ads resource name format')
        })

        it('throws when input exceeds 256 characters', () => {
          expect(() => validateResourceName('a'.repeat(257))).toThrow('Invalid Google Ads resource name format')
        })

        it('accepts a single-depth resource name', () => {
          expect(validateResourceName('customers/1234567890')).toBe('customers/1234567890')
        })

        it('accepts a two-depth resource name', () => {
          expect(validateResourceName('customers/1234567890/campaigns/9876543210')).toBe('customers/1234567890/campaigns/9876543210')
        })

        it('accepts underscore in the type segment', () => {
          expect(validateResourceName('customers/1234567890/asset_groups/1111111111')).toBe('customers/1234567890/asset_groups/1111111111')
        })
      })

      describe('campaign ID guard (via updateGoogleAdsCampaign)', () => {
        it('throws when campaign ID is non-numeric', async () => {
          await expect(
            client.updateGoogleAdsCampaign(
              MOCK_GOOGLE_ADS.userTokenId,
              MOCK_GOOGLE_ADS.developerToken,
              MOCK_GOOGLE_ADS.customerId,
              'abc',
              { name: 'Test' }
            )
          ).rejects.toThrow('Invalid campaign ID format')
          expect(fetch).not.toHaveBeenCalled()
        })

        it('throws when campaign ID is empty', async () => {
          await expect(
            client.updateGoogleAdsCampaign(
              MOCK_GOOGLE_ADS.userTokenId,
              MOCK_GOOGLE_ADS.developerToken,
              MOCK_GOOGLE_ADS.customerId,
              '',
              { name: 'Test' }
            )
          ).rejects.toThrow('Invalid campaign ID format')
          expect(fetch).not.toHaveBeenCalled()
        })
      })

      describe('date format guard (via getGoogleAdsCampaignMetrics)', () => {
        it('throws when startDate is not YYYY-MM-DD', async () => {
          await expect(
            client.getGoogleAdsCampaignMetrics(
              MOCK_GOOGLE_ADS.userTokenId,
              MOCK_GOOGLE_ADS.developerToken,
              MOCK_GOOGLE_ADS.customerId,
              { startDate: '2024/01/01', endDate: '2024-12-31' }
            )
          ).rejects.toThrow('Invalid date format. Expected YYYY-MM-DD')
          expect(fetch).not.toHaveBeenCalled()
        })

        it('throws when endDate is not YYYY-MM-DD', async () => {
          await expect(
            client.getGoogleAdsCampaignMetrics(
              MOCK_GOOGLE_ADS.userTokenId,
              MOCK_GOOGLE_ADS.developerToken,
              MOCK_GOOGLE_ADS.customerId,
              { startDate: '2024-01-01', endDate: 'not-a-date' }
            )
          ).rejects.toThrow('Invalid date format. Expected YYYY-MM-DD')
          expect(fetch).not.toHaveBeenCalled()
        })

        it('throws when date is missing the dashes', async () => {
          await expect(
            client.getGoogleAdsCampaignMetrics(
              MOCK_GOOGLE_ADS.userTokenId,
              MOCK_GOOGLE_ADS.developerToken,
              MOCK_GOOGLE_ADS.customerId,
              { startDate: '20240101', endDate: '2024-12-31' }
            )
          ).rejects.toThrow('Invalid date format. Expected YYYY-MM-DD')
          expect(fetch).not.toHaveBeenCalled()
        })
      })
    })
  })
})
