/**
 * React 18/19 compatibility for UMD bundles that read legacy React internals.
 *
 * CDS ESM components no longer need shims here because deps-esm.js supplies
 * react/jsx-runtime from the host (Muse/BAM pattern), so CDS uses React 19's
 * jsx-runtime natively.
 *
 * This module retains only the shimReactInternals() export used by
 * DomainPurchaseWidget for @px/checkouts UMD compatibility.
 */

import { logger } from '@/lib/request-context'

function applyReact18Compat(react: unknown): boolean {
  if (!react || typeof react !== 'object') return false
  const r = react as Record<string, { ReactCurrentOwner?: { current: unknown } } | undefined>

  let applied = false

  if (!r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
    const internals = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
    if (internals) {
      r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = internals
      applied = true
    }
  }

  const secret = r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  if (secret && !secret.ReactCurrentOwner) {
    secret.ReactCurrentOwner = { current: null }
    applied = true
  }

  return applied
}

/**
 * Legacy shim for non-CDS consumers (e.g. DomainPurchaseWidget / @px/checkouts).
 * Bridges React 19's renamed internals key so UMD bundles that read
 * window.React.__SECRET_INTERNALS find the value they expect.
 */
export function shimReactInternals(): void {
  if (typeof window === 'undefined') return
  const applied = applyReact18Compat((window as any).React)
  if (applied) {
    logger.info('reactCompat.shimReactInternals.activated', {
      hasSecretInternals: !!((window as any).React?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED),
      hasReactCurrentOwner: !!((window as any).React?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner),
    })
  }
}
