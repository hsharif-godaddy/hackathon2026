import { getSwitchboardValue } from '@/hooks/useSwitchboard'

export const DESIGN_KIT_WIZARD_PROFILE = 'initial-agent-design-kit'

export function isDesignKitWizardProfile(profile: string | null | undefined): boolean {
  return profile === DESIGN_KIT_WIZARD_PROFILE
}

/**
 * Whether the Design Kit Wizard is active for this session.
 *
 * The agent profile is now server-resolved and JWT-only (the per-project
 * ProfileSelector + useDevelopPageStore.selectedProfile were removed in main's
 * deterministic-resolution refactor). We read the same Switchboard value the
 * server uses to pick the profile — `appbuilder-agent-profile` — and treat the
 * value `initial-agent-design-kit` as "in the design kit agent".
 *
 * Returns false during SSR (gasketData is client-only); the brand tab is
 * client-interactive, so the wizard resolves on hydration.
 */
export function useIsDesignKitWizardProfile(): boolean {
  return isDesignKitWizardProfile(getSwitchboardValue('appbuilder-agent-profile'))
}
