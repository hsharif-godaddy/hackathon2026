const STORAGE_KEY_PREFIX = 'airo-app-generation-feedback-shown:'

function storageKey(appId: string): string {
  return `${STORAGE_KEY_PREFIX}${appId}`
}

export function hasShownAppGenerationFeedback(appId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(storageKey(appId)) === 'true'
  } catch {
    return false
  }
}

export function markAppGenerationFeedbackShown(appId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(appId), 'true')
  } catch {
    // localStorage can throw in private browsing / quota-exceeded. The banner
    // just won't be deduped on retry; prefer that over a noisy failure.
  }
}
