/**
 * React 18/19 compatibility for UMD bundles that read legacy React internals.
 *
 * CDS ESM components no longer need shims here because deps-esm.js supplies
 * react/jsx-runtime from the host (Muse/BAM pattern), so CDS uses React 19's
 * jsx-runtime natively.
 *
 * This module retains only the shimReactInternals() export used by
 * cdsLoader and DomainPurchaseWidget for UMD compatibility.
 */

import { logger } from '@/lib/request-context'

let trapInstalled = false

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
 * Bridges React 19's renamed internals key so UMD bundles that read
 * window.React.__SECRET_INTERNALS find the value they expect.
 *
 * If window.React exists at call time, patches immediately. Otherwise installs
 * a property setter trap so the patch fires the moment CDS loader assigns
 * window.React (which happens at render time for UMD bundles).
 */
export function shimReactInternals(): void {
  if (typeof window === 'undefined') return

  const win = window as any

  if (win.React) {
    applyAndLog(win.React)
    return
  }

  const descriptor = Object.getOwnPropertyDescriptor(win, 'React')
  if (descriptor && !descriptor.configurable) {
    logger.warn('reactCompat.shimReactInternals.nonConfigurable')
    return
  }

  if (trapInstalled) return
  trapInstalled = true

  let reactValue: unknown

  Object.defineProperty(win, 'React', {
    configurable: true,
    enumerable: true,
    get() { return reactValue },
    set(value: unknown) {
      reactValue = value
      try { applyAndLog(value) } catch (e) {
        logger.warn('reactCompat.shimReactInternals.patchFailed', {
          error: (e as Error).message,
        })
      }
      Object.defineProperty(win, 'React', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: reactValue,
      })
      trapInstalled = false
    },
  })
}

function applyAndLog(react: unknown): void {
  const applied = applyReact18Compat(react)
  if (applied) {
    logger.info('reactCompat.shimReactInternals.activated', {
      hasSecretInternals: !!((react as any)?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED),
      hasReactCurrentOwner: !!((react as any)?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner),
    })
  }
}
