import { ShareTokenRepository } from '../database/repositories/ShareTokenRepository.js'

let shareTokenRepo: ShareTokenRepository | null = null
const getRepo = () => (shareTokenRepo ??= new ShareTokenRepository())

/**
 * Remove `airoShareToken` from a URL, returning the canonical form.
 * Used to ensure the agents DB stores only clean preview URLs — token
 * injection is a presentation concern owned by BFF / share-URL builders.
 * Returns the input unchanged if it cannot be parsed as a URL.
 */
export function stripShareToken(url: string): string {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const parsed = new URL(normalized)
    if (!parsed.searchParams.has('airoShareToken')) return url
    parsed.searchParams.delete('airoShareToken')
    if (!/^https?:\/\//i.test(url)) {
      return parsed.toString().replace(/^https:\/\//, '')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Append the active user share token to a preview URL so the dev-supervisor
 * proxy allows requests (e.g. httpCheck) without requiring a browser cookie.
 * Falls back to the bare URL if no active token exists or the DB lookup fails
 * (ShareTokenRepository already logs the error before rethrowing).
 */
export function resolveAppBaseUrl(previewUrl: string, appId: string): string {
  try {
    const now = Date.now()
    const activeToken = getRepo()
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
