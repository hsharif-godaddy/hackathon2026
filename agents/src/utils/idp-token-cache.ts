import { logger } from '../logging/index.js'
import { decodeJwtExp } from './jwt-expiry.js'

const IDP_TOKEN_MAX_AGE_MS = 5 * 60 * 1000
const cachedIdpTokens = new Map<string, { token: string; cachedAt: number }>()

export function idpTokenCacheKey(conversationId: string): string {
  return `${conversationId}:auth_idp`
}

export function getIdpToken(conversationId: string): string | null {
  const idpCacheKey = idpTokenCacheKey(conversationId)
  const entry = cachedIdpTokens.get(idpCacheKey)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > IDP_TOKEN_MAX_AGE_MS) {
    cachedIdpTokens.delete(idpCacheKey)
    logger.warn('care.idp_token_cache.ttl_evicted', { conversationId })
    return null
  }
  const exp = decodeJwtExp(entry.token)
  if (exp !== null && exp * 1000 <= Date.now()) {
    cachedIdpTokens.delete(idpCacheKey)
    logger.warn('care.idp_token_cache.jwt_expired_on_read', { conversationId })
    return null
  }
  return entry.token
}

/** For tests only — clears the module-level cache Map between test runs. */
export function __clearIdpTokenCache(): void {
  cachedIdpTokens.clear()
}

export function cacheIdpToken(conversationId: string, token: string): boolean {
  const exp = decodeJwtExp(token)
  if (exp !== null && exp * 1000 <= Date.now()) {
    logger.warn('care.idp_token_cache.expired_on_cache', { conversationId })
    return false
  }
  cachedIdpTokens.set(idpTokenCacheKey(conversationId), { token, cachedAt: Date.now() })
  return true
}
