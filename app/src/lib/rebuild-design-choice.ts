import type { RebuildIntakeDesignChoiceId } from '@/app/[market]/develop/components/rebuild/rebuildIntakeInstrumentation'
import type { DesignDirection } from '@/app/[market]/develop/hooks/useRebuildIntake'

/**
 * The two design directions surfaced by the homepage "Rebuild my site" modal.
 * A narrowed subset of {@link DesignDirection} — the modal is the upfront branch
 * between a fresh redesign (`modernize`) and a faithful clone (`keep-similar`).
 */
export type RebuildModalDirection = Extract<DesignDirection, 'modernize' | 'keep-similar'>

// Written on the homepage before any app/jobId exists, then promoted onto the
// resolved id at quick-create (riding the same jobId->appId handoff as the
// initial prompt/template keys in useInitialization).
const PENDING_KEY = 'rebuild-design-choice-pending'
const keyForId = (id: string): string => `rebuild-design-choice-${id}`

export function isRebuildModalDirection(value: unknown): value is RebuildModalDirection {
  return value === 'modernize' || value === 'keep-similar'
}

export function persistPendingDesignChoice(direction: RebuildModalDirection): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(PENDING_KEY, direction)
  } catch {
    // sessionStorage can throw (private mode, quota) — the choice is a soft
    // enhancement, so silently degrade to no persisted direction.
  }
}

function readStoredDirection(key: string): RebuildModalDirection | null {
  try {
    const value = sessionStorage.getItem(key)
    return isRebuildModalDirection(value) ? value : null
  } catch {
    return null
  }
}

export function readPendingDesignChoice(): RebuildModalDirection | null {
  if (typeof window === 'undefined') return null
  return readStoredDirection(PENDING_KEY)
}

/**
 * Move the pending homepage choice onto the resolved jobId/appId namespace so it
 * survives the homepage -> develop handoff. No-op when nothing is pending.
 */
export function promotePendingDesignChoice(id: string): void {
  if (typeof window === 'undefined' || !id) return
  try {
    const pending = readStoredDirection(PENDING_KEY)
    if (!pending) return
    sessionStorage.setItem(keyForId(id), pending)
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // sessionStorage can throw (private mode, quota) — silently degrade.
  }
}

export function readDesignChoiceForId(
  jobId: string | null,
  appId: string | null,
): RebuildModalDirection | null {
  if (typeof window === 'undefined') return null
  for (const id of [jobId, appId]) {
    if (!id) continue
    const found = readStoredDirection(keyForId(id))
    if (found) return found
  }
  return null
}

/**
 * Read the design choice for the app currently in the develop view. Checks the jobId
 * namespace too — the choice is promoted under the jobId at quick-create and copied to
 * the realAppId on the URL flip, which may not have landed when a message is sent.
 */
export function readDesignChoiceForCurrentApp(appId: string | null): RebuildModalDirection | null {
  if (typeof window === 'undefined' || !appId) return null
  return readDesignChoiceForId(sessionStorage.getItem(`initial-job-id-${appId}`), appId)
}

/** Map a modal direction to the intake form's design-choice id for pre-fill. */
export function directionToDesignChoiceId(direction: RebuildModalDirection): RebuildIntakeDesignChoiceId {
  return direction === 'modernize' ? 'modernize' : 'keep_similar'
}
