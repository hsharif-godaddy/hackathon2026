import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import { useActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/useActiveSecretsRequest'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useCurrentAppId } from '@/stores/useStreamingConversationStore'

/**
 * Active secrets request when the composer takeover should replace ChatInput.
 * Matches ChatPane's showSecretsComposer gating so InputActionsPanel can
 * suppress choicelist hoisting before the form mounts.
 */
export function useSecretsComposerTakeover(): ActiveSecretsRequest | null {
  const isSecretsFormEnabled = useSwitchboard(SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM) === true
  const activeSecretsRequest = useActiveSecretsRequest()
  const currentAppId = useCurrentAppId()
  const appId = useAppIdFromParams()

  if (
    !isSecretsFormEnabled ||
    !activeSecretsRequest ||
    !currentAppId ||
    !appId ||
    currentAppId !== appId
  ) {
    return null
  }

  return activeSecretsRequest
}
