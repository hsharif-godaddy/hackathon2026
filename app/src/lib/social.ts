import { logger } from '@/lib/request-context'
import type { GoogleBusinessProfile, GoogleReview, SocialConnection, SocialPublishResult } from '@/types/social'
import { FacebookMediaType, SocialPlatform, SocialPlatformKey } from '@/types/social'
import { getRootDomain } from '@/utils/getRootDomain'
import { validatePlatformScheduleTime } from '@/utils/social/scheduling'

const SOCIAL_V2_BASE_URL = `https://social-v2.api.${getRootDomain() || 'godaddy.com'}`
const SOCIAL_AUTH_BASE_URL = `https://social-auth.api.${getRootDomain() || 'godaddy.com'}`
const FB_API_VERSION = 'v23.0'

/**
 * Instagram Graph API media creation request body (immediate posts only)
 * https://developers.facebook.com/docs/instagram-api/reference/ig-user/media
 *
 * NOTE: For scheduled Instagram posts, use Marketing API (scheduleInstagramPost)
 * which uses ISO 8601 scheduleTime, not Unix publish_time
 */
interface InstagramMediaCreateBody {
  image_url: string
  caption: string
}

/**
 * Facebook Graph API post creation request body
 * https://developers.facebook.com/docs/graph-api/reference/page/feed
 */
interface FacebookPostBody {
  message?: string
  url?: string
  caption?: string
  published?: boolean
  scheduled_publish_time?: number  // Unix timestamp (seconds) - for scheduled posts
}

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
 * Social platform scheduling constraints (via Social V2 proxy)
 * Facebook: 10 min minimum, ~80 days maximum
 * Instagram: 15 min minimum (via Marketing API)
 */

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
 * Permalink fetch retry configuration
 */
const MAX_ATTEMPTS = 3
const RETRY_DELAYS = [2000, 3000]

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
  accountId: string
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

/**
 * Normalize an address into GBP's google.type.PostalAddress shape
 * (regionCode / administrativeArea / locality / addressLines), accepting either
 * that shape or a schema.org PostalAddress (streetAddress / addressRegion /
 * addressLocality / addressCountry — what the site read yields). Without this,
 * GBP rejects the update: "Unknown name 'streetAddress' at
 * 'location.storefront_address': Cannot find field." `regionCode` must be a CLDR
 * region code (e.g. "US"); a full country name would still be rejected by GBP.
 */
const COUNTRY_NAME_TO_CLDR: Record<string, string> = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  america: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  canada: 'CA',
  australia: 'AU',
  'new zealand': 'NZ',
  ireland: 'IE',
}

/**
 * Coerce a region/country value to a CLDR region code for GBP. JSON-LD may give a
 * string ("US", "United States") or an object ({'@type':'Country', name:'United States'}).
 * Returns a 2-letter code uppercased, maps common country names, else passes the string
 * through (GBP returns a clear error rather than us silently dropping the country).
 */
function toRegionCode(value: unknown): string | undefined {
  const raw =
    value && typeof value === 'object'
      ? ((value as { name?: unknown; identifier?: unknown }).name ?? (value as { identifier?: unknown }).identifier)
      : value
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  return COUNTRY_NAME_TO_CLDR[trimmed.toLowerCase()] ?? trimmed
}

export function toGbpPostalAddress(input: unknown): Record<string, unknown> {
  const a = (input ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  // GBP-native fields pass straight through.
  if (a.languageCode != null) out.languageCode = a.languageCode
  if (a.postalCode != null) out.postalCode = a.postalCode
  if (a.administrativeArea != null) out.administrativeArea = a.administrativeArea
  if (a.locality != null) out.locality = a.locality
  // An empty addressLines [] must NOT count as "present": it would both block the streetAddress
  // fallback below and, on a read-then-merge write, replace the current street with nothing.
  const hasAddressLines = Array.isArray(a.addressLines) ? a.addressLines.length > 0 : a.addressLines != null
  if (hasAddressLines) out.addressLines = Array.isArray(a.addressLines) ? a.addressLines : [a.addressLines]
  // GBP-native regionCode wins; fall back to schema.org addressCountry. Both are coerced
  // to a CLDR code (and the object-valued JSON-LD country shape is unwrapped).
  const regionCode = toRegionCode(a.regionCode) ?? toRegionCode(a.addressCountry)
  if (regionCode != null) out.regionCode = regionCode
  // schema.org PostalAddress → GBP, only where the GBP field isn't already set.
  if (out.addressLines == null && a.streetAddress != null) out.addressLines = [a.streetAddress]
  if (out.locality == null && a.addressLocality != null) out.locality = a.addressLocality
  if (out.administrativeArea == null && a.addressRegion != null) out.administrativeArea = a.addressRegion
  return out
}

const GBP_DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/** Day label (any case, full/abbrev, or schema.org URL) → GBP DayOfWeek enum. */
function toGbpDay(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const seg = (value.split('/').pop() ?? value).trim().toUpperCase()
  return GBP_DAYS.find((d) => d === seg || d.startsWith(seg.slice(0, 3))) ?? null
}

/** "11:00" / "11:00 PM" / {hours,minutes} → GBP TimeOfDay {hours, minutes}. */
function toGbpTimeOfDay(value: unknown): { hours: number; minutes: number } | null {
  if (value && typeof value === 'object') {
    const t = value as { hours?: number; minutes?: number }
    if (typeof t.hours === 'number') return { hours: t.hours, minutes: t.minutes ?? 0 }
    return null
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d{1,2}):(\d{2})/)
    if (!m) return null
    let hours = Number(m[1])
    const minutes = Number(m[2])
    if (/pm/i.test(value) && hours < 12) hours += 12
    if (/am/i.test(value) && hours === 12) hours = 0
    return { hours, minutes }
  }
  return null
}

interface GbpPeriod {
  openDay: string
  openTime: { hours: number; minutes: number }
  closeDay: string
  closeTime: { hours: number; minutes: number }
}

/**
 * Normalize hours into GBP's regularHours { periods: [...] } shape. GBP rejects
 * the day-keyed shape the agent tends to produce ({ monday: { openTime, closeTime } })
 * and schema.org openingHoursSpecification arrays — both must become periods with
 * openDay/openTime{hours,minutes}. Accepts those two shapes plus GBP-native periods;
 * closed/unparseable days are dropped (GBP treats a missing day as closed).
 */
export function toGbpRegularHours(input: unknown): { periods: GbpPeriod[] } {
  const periods: GbpPeriod[] = []
  const a = input as Record<string, unknown> & { periods?: unknown[] }

  const push = (dayKey: unknown, open: unknown, close: unknown, closeDayKey?: unknown): void => {
    const openDay = toGbpDay(dayKey)
    const openTime = toGbpTimeOfDay(open)
    const closeTime = toGbpTimeOfDay(close)
    if (!openDay || !openTime || !closeTime) return
    const explicitCloseDay = toGbpDay(closeDayKey)
    // Overnight period (closes at/before it opens, e.g. 22:00→02:00) rolls to the next
    // day; without this the period would be a backwards same-day Mon→Mon.
    const overnight = closeTime.hours * 60 + closeTime.minutes <= openTime.hours * 60 + openTime.minutes
    const closeDay = explicitCloseDay ?? (overnight ? GBP_DAYS[(GBP_DAYS.indexOf(openDay) + 1) % 7]! : openDay)
    periods.push({ openDay, openTime, closeDay, closeTime })
  }

  if (a && Array.isArray(a.periods)) {
    for (const p of a.periods as Array<Record<string, unknown>>) {
      push(p.openDay, p.openTime, p.closeTime, p.closeDay)
    }
  } else if (Array.isArray(input)) {
    // schema.org openingHoursSpecification
    for (const spec of input as Array<Record<string, unknown>>) {
      const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek]
      for (const d of days) push(d, spec.opens, spec.closes)
    }
  } else if (a && typeof a === 'object') {
    // day-keyed: { monday: { openTime, closeTime } | { open, close } }
    for (const [day, val] of Object.entries(a)) {
      if (!val || typeof val !== 'object') continue
      const v = val as Record<string, unknown>
      push(day, v.openTime ?? v.opens ?? v.open, v.closeTime ?? v.closes ?? v.close)
    }
  }

  return { periods }
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
    const url = `${SOCIAL_V2_BASE_URL}/facebook/proxy/${FB_API_VERSION}/${igAccountId}?fields=biography,username,profile_picture_url,name`

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
      `${SOCIAL_V2_BASE_URL}/facebook/proxy/${FB_API_VERSION}/me/accounts?fields=id,name,category,picture{url},instagram_business_account{id,username,name,profile_picture_url}`,
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
      const accountId = account.name?.split('/')[1]
      if (!accountId) continue

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
                accountId,
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

  async getGoogleReviews(userTokenId: string, accountId: string, locationId: string, pageSize = 10): Promise<GoogleReview[]> {
    const url = `${SOCIAL_V2_BASE_URL}/google/proxy/mybusiness/v4/accounts/${accountId}/locations/${locationId}/reviews?pageSize=${pageSize}`

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'X-Token-Id': userTokenId,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch Google reviews: ${response.status}`)
    }

    const data = await response.json()
    if (!Array.isArray(data.reviews)) {
      throw new Error(`Unexpected response shape from Google reviews API: missing reviews array`)
    }
    return data.reviews
  }

  /**
   * Read the editable Google Business Profile listing (name, address, phone,
   * hours, website) via the GBP Business Information API. Unlike
   * getGoogleLocations (which lists limited fields under accounts), this reads
   * the full editable subset for a single location. The v1 location resource is
   * keyed by locationId alone — no accountId required.
   */
  async getGoogleBusinessProfile(userTokenId: string, locationId: string): Promise<GoogleBusinessProfile> {
    const readMask = 'title,storefrontAddress,phoneNumbers,regularHours,websiteUri,profile'
    const url = `${SOCIAL_V2_BASE_URL}/google/proxy/mybusinessbusinessinformation/v1/locations/${locationId}?readMask=${readMask}`

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'X-Token-Id': userTokenId,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch Google Business Profile: ${response.status}`)
    }

    // Explicit shape for the readMask response (no `any` across the GBP API trust boundary).
    const location = (await response.json()) as {
      title?: string
      storefrontAddress?: GoogleBusinessProfile['storefrontAddress']
      phoneNumbers?: { primaryPhone?: string }
      regularHours?: GoogleBusinessProfile['regularHours']
      websiteUri?: string
      profile?: { description?: string }
    }
    return {
      name: location.title ?? '',
      storefrontAddress: location.storefrontAddress,
      primaryPhone: location.phoneNumbers?.primaryPhone,
      regularHours: location.regularHours,
      websiteUri: location.websiteUri,
      description: location.profile?.description,
    }
  }

  /**
   * Read raw location fields (GBP-native shape) for merge-before-write. Unlike
   * getGoogleBusinessProfile, this returns the untouched resource so callers can
   * preserve subfields a whole-field updateMask would otherwise clear (e.g.
   * phoneNumbers.additionalPhones).
   */
  private async readLocationFields(
    userTokenId: string,
    locationId: string,
    readMask: string,
  ): Promise<Record<string, unknown>> {
    const url = `${SOCIAL_V2_BASE_URL}/google/proxy/mybusinessbusinessinformation/v1/locations/${locationId}?readMask=${readMask}`
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'X-Token-Id': userTokenId,
        'Accept': 'application/json',
      },
    })
    if (!response.ok) {
      throw new Error(`Failed to read current Google Business Profile before update: ${response.status}`)
    }
    return (await response.json()) as Record<string, unknown>
  }

  /**
   * Write a subset of fields back to the Google Business Profile listing via the
   * Business Information API. Keyed by locationId (no accountId). `updates` uses
   * the GoogleBusinessProfile field names; this maps them to the GBP location
   * field paths and PATCHes only the changed fields via `updateMask`.
   *
   * @returns the GoogleBusinessProfile field keys that were sent.
   */
  async updateGoogleBusinessProfile(
    userTokenId: string,
    locationId: string,
    updates: Partial<GoogleBusinessProfile>,
  ): Promise<{ updated: string[] }> {
    const body: Record<string, unknown> = {}
    const maskPaths: string[] = []

    // Normalize/validate the structured fields up front so bad input fails fast,
    // before the read-then-merge network round-trip below.
    const normalizedAddress = updates.storefrontAddress !== undefined ? toGbpPostalAddress(updates.storefrontAddress) : undefined
    if (normalizedAddress && Object.keys(normalizedAddress).length === 0) {
      // Nothing in the input mapped to a GBP address field; merging would no-op and
      // an unmerged PATCH would clear the address. Fail loudly so the agent re-shapes.
      throw new Error(
        'Could not map the address to a Google Business Profile address. Provide addressLines, ' +
          'locality, administrativeArea, postalCode, and/or regionCode (a CLDR country code like "US") ' +
          '— or the schema.org streetAddress/addressLocality/addressRegion/addressCountry equivalents.',
      )
    }
    const normalizedHours = updates.regularHours !== undefined ? toGbpRegularHours(updates.regularHours) : undefined
    if (normalizedHours && normalizedHours.periods.length === 0) {
      throw new Error(
        'Could not map the hours to Google Business Profile regular hours. Provide day-keyed hours ' +
          '({ monday: { openTime: "09:00", closeTime: "17:00" }, … }), a schema.org ' +
          'openingHoursSpecification array, or GBP periods — with parseable open/close times.',
      )
    }

    // Treat empty/whitespace strings as no-ops, not field clears: a PATCH with title/
    // websiteUri/primaryPhone = "" would wipe the value on the live listing.
    const nonEmpty = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() !== '' ? value : undefined
    const name = nonEmpty(updates.name)
    const primaryPhone = nonEmpty(updates.primaryPhone)
    const websiteUri = nonEmpty(updates.websiteUri)
    const description = nonEmpty(updates.description)

    // phoneNumbers and storefrontAddress are masked as whole fields, so a PATCH
    // REPLACES the entire field — any subfield we don't send (additionalPhones, the
    // address lines a partial update omits) would be wiped. Read the current values
    // first and merge our changes onto them.
    const phoneFields = primaryPhone !== undefined ? ['phoneNumbers'] : []
    const addressFields = normalizedAddress ? ['storefrontAddress'] : []
    const mergeReadMask = [...phoneFields, ...addressFields].join(',')
    const current = mergeReadMask ? await this.readLocationFields(userTokenId, locationId, mergeReadMask) : {}

    if (name !== undefined) {
      body.title = name
      maskPaths.push('title')
    }
    if (primaryPhone !== undefined) {
      // GBP rejects masking `phoneNumbers.primaryPhone` alone ("primary or additional
      // phone numbers cannot be updated independently"), so mask the whole field and
      // merge to preserve any additionalPhones.
      const currentPhones = (current.phoneNumbers ?? {}) as Record<string, unknown>
      body.phoneNumbers = { ...currentPhones, primaryPhone }
      maskPaths.push('phoneNumbers')
    }
    if (normalizedAddress) {
      // Merge onto the current address so a partial update (e.g. only locality) keeps
      // the untouched lines; incoming subfields win.
      const currentAddress = (current.storefrontAddress ?? {}) as Record<string, unknown>
      body.storefrontAddress = { ...currentAddress, ...normalizedAddress }
      maskPaths.push('storefrontAddress')
    }
    if (normalizedHours) {
      // regularHours is a complete weekly schedule, so a whole-field replace is correct.
      body.regularHours = normalizedHours
      maskPaths.push('regularHours')
    }
    if (websiteUri !== undefined) {
      body.websiteUri = websiteUri
      maskPaths.push('websiteUri')
    }
    if (description !== undefined) {
      // GBP nests the business description under `profile`. (GBP rejects URLs and text
      // over ~750 chars — surfaced as a 400 the caller relays.)
      body.profile = { description }
      maskPaths.push('profile.description')
    }

    if (maskPaths.length === 0) {
      throw new Error('No Google Business Profile fields to update')
    }

    const url = `${SOCIAL_V2_BASE_URL}/google/proxy/mybusinessbusinessinformation/v1/locations/${locationId}?updateMask=${encodeURIComponent(maskPaths.join(','))}`

    const response = await fetch(url, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'X-Token-Id': userTokenId,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to update Google Business Profile: ${response.status} - ${errorText}`)
    }

    return { updated: Object.keys(updates) }
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
    platform: SocialPlatformKey
    userTokenId: string
    pageId?: string
    pageTokenId?: string
    locationId?: string
    accountId?: string
    userId: string
  }): Promise<{ socialId: string }> {
    const body = params.pageId
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
          accountId: params.accountId,
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
        headers: { 'Accept': 'application/json',
          'Content-Type': 'application/json',
        }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch connection: ${response.status} - ${errorText}`)
    }

    return response.json()
  }

  async fetchPermalink(params: {
    mediaId: string
    tokenId: string
    platform: 'facebook' | 'instagram'
    mediaType?: FacebookMediaType
  }): Promise<string | null> {
    let field: string
    if (params.platform === 'instagram') {
      field = 'permalink'
    } else {
      field = params.mediaType === FacebookMediaType.POST ? 'permalink_url' : 'link'
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(
          `${SOCIAL_V2_BASE_URL}/facebook/proxy/${FB_API_VERSION}/${params.mediaId}?fields=${field}`,
          {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'X-Token-Id': params.tokenId
            }
          }
        )

        if (response.ok) {
          const data = await response.json()
          let permalink = data[field]

          if (permalink) {
            if (params.platform === 'facebook' && permalink.startsWith('/')) {
              permalink = `https://www.facebook.com${permalink}`
            }

            logger.info('social.permalink.success', {
              mediaId: params.mediaId,
              platform: params.platform,
              attempts: attempt + 1
            })

            return permalink
          }
        }

        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]))
        }
      } catch (error) {
        logger.debug('social.permalink.attempt.failed', {
          mediaId: params.mediaId,
          platform: params.platform,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : 'Unknown error'
        })

        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]))
        }
      }
    }

    logger.warn('social.permalink.max_attempts', {
      mediaId: params.mediaId,
      platform: params.platform,
      attempts: MAX_ATTEMPTS
    })

    return null
  }

  async publishToFacebook(params: {
    pageId: string
    tokenId: string
    message: string
    imageUrls: string[]
    scheduledAt?: Date
  }): Promise<SocialPublishResult> {
    if (params.scheduledAt) {
      const validation = validatePlatformScheduleTime(params.scheduledAt, SocialPlatform.FACEBOOK)
      if (!validation.isValid) {
        logger.error('social.facebook.publish.validation.failed', {
          pageId: params.pageId,
          scheduledAt: params.scheduledAt,
          error: validation.error
        })
        throw new Error(validation.error)
      }
    }

    const hasImages = params.imageUrls.length > 0
    const endpoint = hasImages ? 'photos' : 'feed'

    const body: FacebookPostBody = hasImages
      ? { url: params.imageUrls[0], caption: params.message }
      : { message: params.message }

    if (params.scheduledAt) {
      body.published = false
      body.scheduled_publish_time = Math.floor(params.scheduledAt.getTime() / 1000)
    }

    const response = await fetch(
      `${SOCIAL_V2_BASE_URL}/facebook/proxy/${FB_API_VERSION}/${params.pageId}/${endpoint}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Token-Id': params.tokenId
        },
        body: JSON.stringify(body)
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `Failed to publish to Facebook: ${response.status}`)
    }

    const data = await response.json()

    if (!params.scheduledAt && data.id) {
      // For photos, use post_id to get the post permalink (not the photo link which requires login)
      // For regular posts, use the post id directly
      const mediaId = hasImages && data.post_id ? data.post_id : data.id

      const permalink = await this.fetchPermalink({
        mediaId,
        tokenId: params.tokenId,
        platform: 'facebook',
        // Always use POST type to get permalink_url (public post URL)
        mediaType: FacebookMediaType.POST
      })

      if (permalink) {
        data.platformUrl = permalink
      }
    }

    return data
  }

  /**
   * Publish to Instagram via Facebook Graph API (immediate posts only)
   *
   * For scheduled Instagram posts, use the Marketing API (scheduleInstagramPost)
   * which uses the Chatterbox job scheduler for reliable delayed posting.
   *
   * @param params.igAccountId - Instagram business account ID
   * @param params.tokenId - Token ID for authentication
   * @param params.imageUrl - Public URL of the image to post
   * @param params.caption - Post caption text
   * @param params.scheduledAt - NOT SUPPORTED. Instagram does not support scheduled posts via Graph API. Use scheduleInstagramPost() from marketing-api.ts instead.
   * @see scheduleInstagramPost in marketing-api.ts for scheduled Instagram posts
   */
  async publishToInstagram(params: {
    igAccountId: string
    tokenId: string
    imageUrl: string
    caption: string
  }): Promise<SocialPublishResult> {
    logger.info('social.instagram.publish.start', {
      igAccountId: params.igAccountId
    })

    const createBody: InstagramMediaCreateBody = {
      image_url: params.imageUrl,
      caption: params.caption
    }

    logger.debug('social.instagram.publish.container.create', {
      igAccountId: params.igAccountId
    })
    const createResponse = await fetch(
      `${SOCIAL_V2_BASE_URL}/facebook/proxy/${FB_API_VERSION}/${params.igAccountId}/media`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Token-Id': params.tokenId
        },
        body: JSON.stringify(createBody)
      }
    )

    if (!createResponse.ok) {
      const errorData = await createResponse.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `Failed to create Instagram media: ${createResponse.status}`)
    }

    const createData = await createResponse.json()
    const containerId = createData.id
    logger.debug('social.instagram.publish.container.success', {
      containerId
    })

    // Publish the media container immediately
    logger.debug('social.instagram.publish.media.publish', {
      containerId,
      igAccountId: params.igAccountId
    })
    const publishResponse = await fetch(
      `${SOCIAL_V2_BASE_URL}/facebook/proxy/${FB_API_VERSION}/${params.igAccountId}/media_publish`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Token-Id': params.tokenId
        },
        body: JSON.stringify({
          creation_id: containerId
        })
      }
    )

    if (!publishResponse.ok) {
      const errorData = await publishResponse.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `Failed to publish Instagram media: ${publishResponse.status}`)
    }

    const publishData = await publishResponse.json()
    logger.info('social.instagram.publish.success', {
      postId: publishData.id,
      igAccountId: params.igAccountId
    })

    if (publishData.id) {
      const permalink = await this.fetchPermalink({
        mediaId: publishData.id,
        tokenId: params.tokenId,
        platform: 'instagram'
      })

      if (permalink) {
        publishData.platformUrl = permalink
      }
    }

    return publishData
  }

}

export const socialV2Client = new SocialV2Client()
