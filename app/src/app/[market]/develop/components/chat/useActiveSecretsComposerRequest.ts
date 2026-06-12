import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import { useActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/useActiveSecretsRequest'

/** @deprecated Use ActiveSecretsRequest from chat/secrets */
export type ActiveSecretsComposerRequest = ActiveSecretsRequest

/** @deprecated Use useActiveSecretsRequest from chat/secrets */
export function useActiveSecretsComposerRequest(): ActiveSecretsRequest | null {
  return useActiveSecretsRequest()
}
