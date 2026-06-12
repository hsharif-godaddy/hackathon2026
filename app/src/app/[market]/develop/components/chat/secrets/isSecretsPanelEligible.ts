import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'

/**
 * Determines if a secrets request is eligible for the input-area panel
 * vs in-thread card.
 *
 * Ineligible:
 * - autoSubmit (no user interaction needed)
 * - allowMultiple (dynamic/unlimited secrets need thread UI)
 */
export function isSecretsPanelEligible(payload: SecretsRequestPayload): boolean {
  if (payload.autoSubmit) {
    return false
  }

  if (payload.allowMultiple) {
    return false
  }

  if (!Array.isArray(payload.secrets) || payload.secrets.length === 0) {
    return false
  }

  const firstSecret = payload.secrets[0]
  if (!firstSecret?.name || typeof firstSecret.name !== 'string' || firstSecret.name.trim() === '') {
    return false
  }

  return true
}
