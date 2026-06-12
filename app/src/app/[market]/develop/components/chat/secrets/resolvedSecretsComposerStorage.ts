import { logger } from '@/lib/request-context'

const storageKey = (appId: string) => `airo-secrets-composer-resolved:${appId}`

export function loadResolvedSecretsComposerToolCallIds(appId: string): Record<string, true> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = localStorage.getItem(storageKey(appId))
    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const ids: Record<string, true> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) {
        ids[key] = true
      }
    }
    return ids
  } catch (error: unknown) {
    logger.warn('secrets.resolved.storage.unreadable', { appId, error })
    return {}
  }
}

export function saveResolvedSecretsComposerToolCallIds(
  appId: string,
  ids: Record<string, true>,
): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    localStorage.setItem(storageKey(appId), JSON.stringify(ids))
  } catch {
    // Quota or private mode — in-memory resolution still applies for this session.
  }
}

export function mergeResolvedSecretsComposerToolCallIds(
  appId: string,
  ids: Record<string, true>,
): Record<string, true> {
  return {
    ...loadResolvedSecretsComposerToolCallIds(appId),
    ...ids,
  }
}
