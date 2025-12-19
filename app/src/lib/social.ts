import type { SocialConnection } from '@/types/social'

const SOCIAL_V2_BASE_URL = process.env.NEXT_PUBLIC_SOCIAL_V2_API_URL || 'https://social-v2.api.dev-godaddy.com'
const SOCIAL_AUTH_BASE_URL = process.env.NEXT_PUBLIC_SOCIAL_AUTH_API_URL || 'https://social-auth.api.dev-godaddy.com'

/**
 * Time constants for social platform integration
 */
const MINUTE_MS = 60 * 1000
const MINUTES = (n: number) => n * MINUTE_MS

/**
 * OAuth flow timeout - how long to wait for user to complete OAuth
 */
export const OAUTH_TIMEOUT_MS = MINUTES(5) // 5 minutes

/**
 * React Query cache configurations for social data
 */
export const SOCIAL_CACHE_CONFIG = {
  METADATA: {
    staleTime: MINUTES(10),  // Metadata rarely changes
    gcTime: MINUTES(30),
  },
  AUTH_URL: {
    staleTime: MINUTES(5),   // Auth URLs are short-lived
    gcTime: MINUTES(10),
  },
  PERMISSIONS: {
    staleTime: 0,            // Always fresh for security
    gcTime: 0,
  },
} as const

/**
 * State machine and UI configuration
 */
export const SOCIAL_FLOW_CONFIG = {
  maxRetries: 3,
  displayConnectionsLimit: 2,
} as const

/**
 * Empty array constants to prevent new references on every render
 * Use these instead of creating new empty arrays in components
 */
export const EMPTY_SOCIAL_ARRAYS = {
  connections: [] as SocialConnection[],
  scopes: [] as string[],
  pages: [] as FacebookPage[],
  locations: [] as GoogleLocation[],
} as const

export interface FacebookPage {
  id: string
  name: string
  category?: string
  picture?: {
    data?: {
      url?: string
    }
  }
  instagram_business_account?: {
    id: string
    username?: string
    name?: string
    profile_picture_url?: string
  }
  access_token?: string
  tasks?: string[]
}

export interface GoogleLocation {
  id: string
  name: string
  title: string
  storefrontAddress?: {
    regionCode?: string
    postalCode?: string
    administrativeArea?: string
    locality?: string
    addressLines?: string[]
  }
}

export interface YelpBusiness {
  id: string
  name: string
  location?: {
    address1?: string
    city?: string
    state?: string
    zip_code?: string
  }
  categories?: Array<{ alias: string; title: string }>
  rating?: number
  review_count?: number
}

export class SocialV2Client {
  async getSocialConnections(): Promise<SocialConnection[]> {
    const response = await fetch(`${SOCIAL_V2_BASE_URL}/social_connections`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch connections: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const connections = Array.isArray(data) ? data : (data.connections || [])
    return connections
  }

  async getSocialConnectionsBatch(socialIds: string[]): Promise<SocialConnection[]> {
    if (socialIds.length === 0) return []

    const response = await fetch(`${SOCIAL_V2_BASE_URL}/social_connections/batch`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ ids: socialIds })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch connections batch: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    return Array.isArray(data) ? data : (data.connections || [])
  }

  async validatePermissions(
    platform: string,
    userTokenId: string,
    requiredScopes: string[]
  ): Promise<{ valid: boolean; missingScopes: string[] }> {
    const encodedToken = encodeURIComponent(userTokenId)
    const response = await fetch(
      `${SOCIAL_AUTH_BASE_URL}/platforms/${platform}/tokens/${encodedToken}`,
      {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to validate permissions: ${response.status} - ${errorText}`)
    }

    const { data } = await response.json()
    const grantedScopes = data.scopes || []
    const missingScopes = requiredScopes.filter(scope => !grantedScopes.includes(scope))

    return {
      valid: missingScopes.length === 0,
      missingScopes
    }
  }

  async getInstagramAccount(userTokenId: string, igAccountId: string): Promise<{ username: string; name?: string; biography?: string; profile_picture_url?: string }> {
    const url = `${SOCIAL_V2_BASE_URL}/facebook/proxy/v18.0/${igAccountId}?fields=biography,username,profile_picture_url,name`

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Token-Id': userTokenId,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch Instagram account: ${response.status}`)
    }

    return response.json()
  }

  async getFacebookPages(userTokenId: string): Promise<FacebookPage[]> {
    const response = await fetch(
      `${SOCIAL_V2_BASE_URL}/facebook/proxy/v18.0/me/accounts?fields=id,name,category,picture{url},instagram_business_account{id,username,name,profile_picture_url}`,
      {
        credentials: 'include',
        headers: {
          'X-Token-Id': userTokenId,
          'Accept': 'application/json'
        }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch Facebook pages: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    return result.data || []
  }

  async getGoogleLocations(userTokenId: string): Promise<GoogleLocation[]> {

    const accountsUrl = `${SOCIAL_V2_BASE_URL}/google/proxy/mybusinessaccountmanagement/v1/accounts`

    const accountsResponse = await fetch(accountsUrl, {
      credentials: 'include',
      headers: {
        'X-Token-Id': userTokenId,
        'Accept': 'application/json'
      }
    })

    if (!accountsResponse.ok) {
      const errorText = await accountsResponse.text()
      throw new Error(`Failed to fetch Google accounts: ${accountsResponse.status} - ${errorText}`)
    }

    const { accounts } = await accountsResponse.json()

    const allLocations: GoogleLocation[] = []

    for (const account of accounts || []) {
      const accountId = account.name.split('/')[1]

      const locationsResponse = await fetch(
        `${SOCIAL_V2_BASE_URL}/google/proxy/mybusinessbusinessinformation/v1/accounts/${accountId}/locations?readMask=name,title,storefrontAddress`,
        {
          credentials: 'include',
          headers: {
            'X-Token-Id': userTokenId,
            'Accept': 'application/json'
          }
        }
      )

      if (locationsResponse.ok) {
        const { locations } = await locationsResponse.json()

        for (const location of locations || []) {
          const locationId = location.name.split('/')[1]

          const vomResponse = await fetch(
            `${SOCIAL_V2_BASE_URL}/google/proxy/mybusinessverifications/v1/locations/${locationId}/VoiceOfMerchantState`,
            {
              credentials: 'include',
              headers: {
                'X-Token-Id': userTokenId,
                'Accept': 'application/json'
              }
            }
          )

          if (vomResponse.ok) {
            const vomData = await vomResponse.json()
            if (vomData.hasVoiceOfMerchant) {
              allLocations.push({
                id: locationId,
                name: location.name,
                title: location.title,
                storefrontAddress: location.storefrontAddress
              })
            } else {
               // Locations without VoiceOfMerchant are intentionally skipped
            }
          }
        }
      }
    }

    return allLocations
  }

  async getYelpBusiness(userTokenId: string, businessId: string): Promise<YelpBusiness> {
    const url = `${SOCIAL_V2_BASE_URL}/yelp/proxy/api/v3/businesses/${businessId}`

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Token-Id': userTokenId,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch Yelp business: ${response.status}`)
    }

    return response.json()
  }

  async createConnection(params: {
    platform: 'FACEBOOK' | 'GOOGLE_BUSINESS_PROFILE' | 'TIKTOK' | 'YELP' | 'WHATSAPP' | 'INSTAGRAM'
    userTokenId: string
    pageId?: string
    pageTokenId?: string
    locationId?: string
    userId: string
  }): Promise<{ socialId: string }> {
    const body = params.platform === 'FACEBOOK'
      ? {
          platform: params.platform,
          pageId: params.pageId,
          userId: params.userId,
          userTokenId: params.userTokenId,
          pageTokenId: params.pageTokenId
        }
      : {
          platform: params.platform,
          locationId: params.locationId,
          userId: params.userId,
          userTokenId: params.userTokenId
        }

    const response = await fetch(
      `${SOCIAL_V2_BASE_URL}/social_connections`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to create connection: ${response.status} - ${errorText}`)
    }

    const responseData = await response.json()
    const data = responseData.data || responseData

    if (data.connections && Array.isArray(data.connections) && data.connections.length > 0) {
      return { socialId: data.connections[0].socialId }
    }

    return { socialId: data.socialId }
  }

  async getConnectionById(socialId: string): Promise<SocialConnection> {
    const response = await fetch(
      `${SOCIAL_V2_BASE_URL}/social_connections/${socialId}`,
      {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch connection: ${response.status} - ${errorText}`)
    }

    return response.json()
  }
}

export const socialV2Client = new SocialV2Client()
