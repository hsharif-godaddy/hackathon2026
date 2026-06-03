import { shareTokenRepository } from '../database/repositories/index.js'

/**
 * Append the active user share token to a preview URL so the dev-supervisor
 * proxy allows requests (e.g. httpCheck) without requiring a browser cookie.
 * Falls back to the bare URL if no active token exists or the DB lookup fails
 * (ShareTokenRepository already logs the error before rethrowing).
 */
export function resolveAppBaseUrl(previewUrl: string, appId: string): string {
  try {
    const now = Date.now()
    const activeToken = shareTokenRepository
      .findByAppId(appId, 'user')
      .find(t => t.expiresAt > now)
    if (!activeToken) return previewUrl
    const normalized = /^https?:\/\//i.test(previewUrl) ? previewUrl : `https://${previewUrl}`
    const parsed = new URL(normalized)
    parsed.searchParams.set('airoShareToken', activeToken.token)
    return parsed.toString()
  } catch {
    return previewUrl
  }
}
