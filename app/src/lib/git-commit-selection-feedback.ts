import Growl from '@ux/growl'

type Translate = (key: string, values?: Record<string, unknown>, fallback?: string) => string

export function notifyCommitSelectionFailure(
  isAuthError: boolean,
  t: Translate,
): void {
  Growl.addGrowlMessage({
    id: 'git-commit-selection-failed',
    title: t(
      isAuthError
        ? 'builder_version_history_switch_auth_error_title'
        : 'builder_version_history_switch_error_title',
      undefined,
      isAuthError ? 'Sign in required' : 'Failed to switch version',
    ),
    children: t(
      isAuthError
        ? 'builder_version_history_switch_auth_error_description'
        : 'builder_version_history_switch_error_description',
      undefined,
      isAuthError
        ? 'Your session expired. Sign in again, then retry switching versions.'
        : "You can't switch between versions while Airo is actively building.",
    ),
    emphasis: 'critical',
    lifetime: 5000,
  })
}
