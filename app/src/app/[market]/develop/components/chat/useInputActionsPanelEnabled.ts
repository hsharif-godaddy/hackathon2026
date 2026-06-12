import { SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'

/**
 * Whether Continue building / InputActionsPanel mounts on the normal chat composer.
 * Secrets takeover is exclusive — the panel is hidden until submit or cancel returns ChatInput.
 */
export function useInputActionsPanelEnabled(): boolean {
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')
  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans') === true
  const isSecretsFormEnabled = useSwitchboard(SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM) === true

  return Boolean(
    isThemeSelectionChatEnabled ||
      isFontSelectionChatEnabled ||
      areChatPlansEnabled ||
      isSecretsFormEnabled,
  )
}
