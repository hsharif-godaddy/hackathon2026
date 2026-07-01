import { logger } from '@/lib/request-context'
import { getRootDomain } from '@/utils/getRootDomain'

const SOCIAL_V2_BASE_URL = `https://social-v2.api.${getRootDomain() || 'godaddy.com'}`

const MAX_VERIFY_RETRIES = 3
const VERIFY_RETRY_DELAY_MS = 3000

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Webmasters calls use /google/proxy/www/webmasters/… (www subdomain, like siteVerification).
 * Site URL path segments must reach Google single-encoded; social-v2 decodes once, so encode twice.
 */
export function encodeWebmastersPathParam(value: string): string {
  return encodeURIComponent(encodeURIComponent(value))
}

const WEBMASTERS_SITES_BASE = '/google/proxy/www/webmasters/v3/sites'

export class GscClient {
  async getGscVerificationToken(siteUrl: string, userTokenId: string): Promise<string> {
    const url = `${SOCIAL_V2_BASE_URL}/google/proxy/www/siteVerification/v1/token`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Token-Id': userTokenId,
      },
      body: JSON.stringify({
        verificationMethod: 'META',
        site: { type: 'SITE', identifier: siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/` },
      }),
    })
    if (!response.ok) {
      throw new Error(`Failed to get GSC verification token: ${response.status}`)
    }
    const data = await response.json() as { token: string }
    // social-auth may return the full <meta> tag HTML or "google-site-verification=CODE"
    const metaContentMatch = data.token.match(/content="([^"]+)"/)
    if (metaContentMatch) {
      return metaContentMatch[1]
    }
    return data.token.replace(/^google-site-verification=/, '')
  }

  async verifyGscSite(siteUrl: string, userTokenId: string): Promise<void> {
    const normalizedSiteUrl = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
    const url = `${SOCIAL_V2_BASE_URL}/google/proxy/www/siteVerification/v1/webResource?verificationMethod=META`

    for (let attempt = 1; attempt <= MAX_VERIFY_RETRIES; attempt++) {
      if (attempt > 1) {
        await sleep(VERIFY_RETRY_DELAY_MS)
      }
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Token-Id': userTokenId,
        },
        body: JSON.stringify({ site: { type: 'SITE', identifier: normalizedSiteUrl } }),
      })
      if (response.ok) {
        logger.info('gsc.verify.success', { attempt })
        return
      }
      logger.warn('gsc.verify.attempt-failed', { attempt, maxRetries: MAX_VERIFY_RETRIES, status: response.status })
      if (attempt === MAX_VERIFY_RETRIES) {
        throw new Error(`GSC site verification failed after ${MAX_VERIFY_RETRIES} attempts: ${response.status}`)
      }
    }
  }

  async addGscSite(siteUrl: string, userTokenId: string): Promise<boolean> {
    const normalizedUrl: string = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
    const encodedSite = encodeWebmastersPathParam(normalizedUrl)
    const url = `${SOCIAL_V2_BASE_URL}${WEBMASTERS_SITES_BASE}/${encodedSite}`

    for (let attempt = 1; attempt <= MAX_VERIFY_RETRIES; attempt++) {
      if (attempt > 1) {
        await sleep(VERIFY_RETRY_DELAY_MS)
      }
      const response = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Token-Id': userTokenId,
        },
      })
      if (response.ok) {
        logger.info('gsc.add-site.success', { attempt })
        return true
      }
      logger.warn('gsc.add-site.attempt-failed', { attempt, maxRetries: MAX_VERIFY_RETRIES, status: response.status })
    }

    logger.warn('gsc.add-site.exhausted', { siteUrl: normalizedUrl })
    return false
  }

  async submitGscSitemap(siteUrl: string, userTokenId: string): Promise<void> {
    const normalizedSiteUrl: string = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
    const sitemapUrl = `${normalizedSiteUrl}sitemap.xml`
    const encodedSite = encodeWebmastersPathParam(normalizedSiteUrl)
    const encodedSitemap = encodeWebmastersPathParam(sitemapUrl)
    const url = `${SOCIAL_V2_BASE_URL}${WEBMASTERS_SITES_BASE}/${encodedSite}/sitemaps/${encodedSitemap}`
    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Token-Id': userTokenId,
      },
    })
    if (!response.ok) {
      throw new Error(`GSC sitemap submit failed: ${response.status}`)
    }
  }
}

export const gscClient = new GscClient()
