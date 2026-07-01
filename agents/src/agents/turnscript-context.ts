import { AsyncLocalStorage } from 'node:async_hooks'

import { getShopperFlag } from '../services/switchboard.js'

interface TurnscriptContext {
  enabled: boolean
}

const als = new AsyncLocalStorage<TurnscriptContext>()

/**
 * Wrap one turn's agent loop so the develop agent's resolvers can read whether
 * turnscript is enabled for THIS turn. Mirrors runWithAutomations: the flag is
 * resolved once upstream (where the shopperId is available) and stashed here so
 * the per-turn `system`/`activeTools` resolvers — which have no shopperId — can
 * read it via isTurnscriptEnabled().
 */
export function runWithTurnscript<T>(enabled: boolean, fn: () => T): T {
  return als.run({ enabled }, fn)
}

/** Whether turnscript is enabled for the current turn (false outside a run scope). */
export function isTurnscriptEnabled(): boolean {
  return als.getStore()?.enabled ?? false
}

/**
 * A GoDaddy TLA (three-letter account) — internal/employee accounts have a
 * 3-character shopperId. Mirror of app/src/lib/is-tla-shopper.ts (the agents
 * package cannot import from the website package).
 */
function isTLAShopper(shopperId: string | undefined): boolean {
  return typeof shopperId === 'string' && shopperId.length === 3
}

/**
 * Is turnscript exposed at all? Two-level config, each level a Switchboard flag OR its
 * env fallback. Resolved per turn — Switchboard's in-process cache refreshes in the
 * background, so flipping a flag reflects mid-conversation without re-minting tokens:
 *   L1 enable   — `appbuilder-turnscript` flag OR `TURNSCRIPT_ENABLED=true`. Unless on,
 *                 turnscript is fully off.
 *   L2 TLA-only — `appbuilder-turnscript-tla-only` flag OR `TURNSCRIPT_TLA_ONLY=true`.
 *                 When on, restrict to TLA (internal) accounts; a non-TLA caller (or
 *                 unknown shopperId) gets off even when L1 is on.
 *
 * The flags key on shopperId so Switchboard per-shopper overrides apply. The fail-safe
 * default is OFF: getShopperFlag returns false when Switchboard is unconfigured or
 * unreachable, so with no flags and no env, turnscript stays off.
 */
export function resolveTurnscriptEnabled(shopperId: string | undefined): boolean {
  const enabled = getShopperFlag('appbuilder-turnscript', shopperId) || process.env.TURNSCRIPT_ENABLED === 'true'
  if (!enabled) return false
  const tlaOnly = getShopperFlag('appbuilder-turnscript-tla-only', shopperId) || process.env.TURNSCRIPT_TLA_ONLY === 'true'
  if (tlaOnly) return isTLAShopper(shopperId)
  return true
}
