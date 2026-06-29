import { ViewMode } from '@/app/[market]/develop/components/types'

/**
 * Initial view for a design-kit session (AIROBUILD-2871).
 *
 * An in-progress immersive build lands on the BRAND tab (the wizard). A finished build —
 * persisted `wizard.phase === 'ready'` — returns null so the app lands in the normal
 * builder instead of replaying "Building your website". Pure + exported for testing; the
 * page wires it into `useView`'s `resolveInitialViewMode`.
 */
export function resolveDesignKitInitialView(
  showDesignKitWizard: boolean,
  buildFinished: boolean,
): ViewMode | null {
  return showDesignKitWizard && !buildFinished ? ViewMode.BRAND : null
}

/**
 * Whether to hold the initial-default landing until the persisted wizard phase settles.
 *
 * The finished-vs-in-progress decision depends on async brand-data. Only hold for a
 * design-kit session that is still loading that data AND isn't a known in-progress fresh
 * create (initial prompt still pending lands immediately, no wait) — otherwise a finished
 * app would briefly flash the wizard before we know to skip it. Pure + exported for testing.
 */
export function isDesignKitInitialViewResolving(
  showDesignKitWizard: boolean,
  hasInitialPrompt: boolean,
  brandLoading: boolean,
): boolean {
  return showDesignKitWizard && !hasInitialPrompt && brandLoading
}
