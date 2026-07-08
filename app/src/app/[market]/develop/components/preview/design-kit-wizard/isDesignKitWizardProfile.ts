import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

export const DESIGN_KIT_WIZARD_PROFILE = 'initial-agent-design-kit'

export function isDesignKitWizardProfile(profile: string | null | undefined): boolean {
  return profile === DESIGN_KIT_WIZARD_PROFILE
}

/**
 * Whether the Design Kit Wizard is active for this session.
 *
 * Reads the server-resolved agent profile from the app record
 * (`useDevelopPageStore.app.agentProfile`), which is set at conversation-create
 * from the JWT `agentProfile` claim and returned on `GET /apps/:id`. This makes
 * the design-kit brand UI independent of the `appbuilder-agent-profile` Switchboard
 * value, so the upcoming JWT-minted experiment cohort works correctly.
 *
 * Returns false until the app record loads; the brand tab is client-interactive
 * so the wizard resolves on hydration.
 */
export function useIsDesignKitWizardProfile(): boolean {
  return isDesignKitWizardProfile(useDevelopPageStore((s) => s.app?.agentProfile))
}
