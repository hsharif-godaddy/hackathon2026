import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'

/**
 * Base fields shared by both single and paginated secret requests.
 */
interface ActiveSecretsRequestBase {
  payload: SecretsRequestPayload
  toolCallId: string
  secretKey: string
  allSecretNames: string[]
}

/**
 * Single-secret request - simple one-field form.
 */
interface ActiveSecretsRequestSingle extends ActiveSecretsRequestBase {
  displayMode: 'single'
}

/**
 * Multi-secret request - paginated multi-step form.
 */
interface ActiveSecretsRequestPaginated extends ActiveSecretsRequestBase {
  displayMode: 'paginated'
}

/**
 * Discriminated union of active secret requests based on display mode.
 * The displayMode field determines whether this is a single-field or paginated form.
 */
export type ActiveSecretsRequest = ActiveSecretsRequestSingle | ActiveSecretsRequestPaginated
