import {
  isRebuildBringOverChoice,
  presetForDirection,
  type RebuildBringOverChoice,
  type RebuildModalDirection,
} from '@airo/shared'

import type { RebuildIntakeDesignChoiceId } from '@/app/[market]/develop/components/rebuild/rebuildIntakeInstrumentation'

// Re-export for call sites that previously imported RebuildModalDirection from here.
export type { RebuildBringOverChoice, RebuildModalDirection }

// Written on the homepage before any app/jobId exists, then promoted onto the
// resolved id at quick-create (riding the same jobId->appId handoff as the
// initial prompt/template keys in useInitialization).
const PENDING_KEY = 'rebuild-design-choice-pending'
const keyForId = (id: string): string => `rebuild-design-choice-${id}`

export function isRebuildModalDirection(value: unknown): value is RebuildModalDirection {
  return value === 'modernize' || value === 'keep-similar'
}

function parseStored(raw: string | null): RebuildBringOverChoice | null {
  if (!raw) return null
  // Legacy: bare direction string stored before the bring-over choice object was introduced.
  if (raw === 'modernize' || raw === 'keep-similar') return presetForDirection(raw)
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRebuildBringOverChoice(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function persistPendingDesignChoice(choice: RebuildBringOverChoice): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(choice))
  } catch {
    // sessionStorage can throw (private mode, quota) — the choice is a soft
    // enhancement, so silently degrade to no persisted choice.
  }
}

export function readPendingDesignChoice(): RebuildBringOverChoice | null {
  if (typeof window === 'undefined') return null
  try {
    return parseStored(sessionStorage.getItem(PENDING_KEY))
  } catch {
    return null
  }
}

/**
 * Move the pending homepage choice onto the resolved jobId/appId namespace so it
 * survives the homepage -> develop handoff. No-op when nothing is pending.
 */
export function promotePendingDesignChoice(id: string): void {
  if (typeof window === 'undefined' || !id) return
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return
    sessionStorage.setItem(keyForId(id), raw)
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // sessionStorage can throw (private mode, quota) — silently degrade.
  }
}

export function readDesignChoiceForId(
  jobId: string | null,
  appId: string | null,
): RebuildBringOverChoice | null {
  if (typeof window === 'undefined') return null
  for (const id of [jobId, appId]) {
    if (!id) continue
    try {
      const found = parseStored(sessionStorage.getItem(keyForId(id)))
      if (found) return found
    } catch {
      // ignore
    }
  }
  return null
}

/**
 * Read the design choice for the app currently in the develop view. Checks the jobId
 * namespace too — the choice is promoted under the jobId at quick-create and copied to
 * the realAppId on the URL flip, which may not have landed when a message is sent.
 */
export function readDesignChoiceForCurrentApp(appId: string | null): RebuildBringOverChoice | null {
  if (typeof window === 'undefined' || !appId) return null
  try {
    return readDesignChoiceForId(sessionStorage.getItem(`initial-job-id-${appId}`), appId)
  } catch {
    return null
  }
}

/** Map a modal direction to the intake form's design-choice id for pre-fill. */
export function directionToDesignChoiceId(direction: RebuildModalDirection): RebuildIntakeDesignChoiceId {
  return direction === 'modernize' ? 'modernize' : 'keep_similar'
}
