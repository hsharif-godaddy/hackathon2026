/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { presetForDirection } from '@airo/shared'

import {
  directionToDesignChoiceId,
  isRebuildModalDirection,
  persistPendingDesignChoice,
  promotePendingDesignChoice,
  readDesignChoiceForCurrentApp,
  readDesignChoiceForId,
  readPendingDesignChoice,
} from './rebuild-design-choice'

afterEach(() => {
  sessionStorage.clear()
})

describe('bring-over choice persistence', () => {
  it('round-trips a full choice object', () => {
    const choice = { direction: 'modernize', keepLogo: false, keepImages: false, keepColors: true, keepFonts: false } as const
    persistPendingDesignChoice(choice)
    expect(readPendingDesignChoice()).toEqual(choice)
  })

  it('reads a legacy bare-string entry as its preset', () => {
    sessionStorage.setItem('rebuild-design-choice-pending', 'keep-similar')
    expect(readPendingDesignChoice()).toEqual(presetForDirection('keep-similar'))
  })
})

describe('rebuild-design-choice persistence', () => {
  it('round-trips a pending choice', () => {
    persistPendingDesignChoice(presetForDirection('modernize'))
    expect(readPendingDesignChoice()).toEqual(presetForDirection('modernize'))
  })

  it('overwrites a prior pending choice', () => {
    persistPendingDesignChoice(presetForDirection('modernize'))
    persistPendingDesignChoice(presetForDirection('keep-similar'))
    expect(readPendingDesignChoice()).toEqual(presetForDirection('keep-similar'))
  })

  it('promotes the pending choice onto a resolved id and clears pending', () => {
    persistPendingDesignChoice(presetForDirection('modernize'))
    promotePendingDesignChoice('job-123')

    expect(readPendingDesignChoice()).toBeNull()
    expect(readDesignChoiceForId('job-123', null)).toEqual(presetForDirection('modernize'))
  })

  it('promote is a no-op when there is no pending choice', () => {
    promotePendingDesignChoice('job-123')
    expect(readDesignChoiceForId('job-123', null)).toBeNull()
  })

  it('reads by jobId first, then falls back to appId', () => {
    persistPendingDesignChoice(presetForDirection('keep-similar'))
    promotePendingDesignChoice('app-789')

    // Stored under app-789; a read that knows only the appId still resolves it.
    expect(readDesignChoiceForId(null, 'app-789')).toEqual(presetForDirection('keep-similar'))
    // jobId namespace empty -> falls through to appId.
    expect(readDesignChoiceForId('job-000', 'app-789')).toEqual(presetForDirection('keep-similar'))
  })

  it('returns null when nothing is stored', () => {
    expect(readPendingDesignChoice()).toBeNull()
    expect(readDesignChoiceForId('nope', 'also-nope')).toBeNull()
  })

  it('ignores a corrupt stored value', () => {
    sessionStorage.setItem('rebuild-design-choice-pending', 'garbage')
    expect(readPendingDesignChoice()).toBeNull()
  })
})

describe('readDesignChoiceForCurrentApp', () => {
  it('resolves the choice via the appId namespace', () => {
    persistPendingDesignChoice(presetForDirection('modernize'))
    promotePendingDesignChoice('app-1')
    expect(readDesignChoiceForCurrentApp('app-1')).toEqual(presetForDirection('modernize'))
  })

  it('resolves the choice via the jobId when only the job namespace has it', () => {
    persistPendingDesignChoice(presetForDirection('keep-similar'))
    promotePendingDesignChoice('job-9')
    // Simulate the develop view knowing the realAppId and its initial-job-id mapping
    // before the choice was copied across the flip.
    sessionStorage.setItem('initial-job-id-app-2', 'job-9')
    expect(readDesignChoiceForCurrentApp('app-2')).toEqual(presetForDirection('keep-similar'))
  })

  it('returns null for a null appId or when nothing is stored', () => {
    expect(readDesignChoiceForCurrentApp(null)).toBeNull()
    expect(readDesignChoiceForCurrentApp('unknown')).toBeNull()
  })
})

describe('directionToDesignChoiceId', () => {
  it('maps modernize to the modernize intake choice', () => {
    expect(directionToDesignChoiceId('modernize')).toBe('modernize')
  })

  it('maps keep-similar to the keep_similar intake choice', () => {
    expect(directionToDesignChoiceId('keep-similar')).toBe('keep_similar')
  })
})

describe('isRebuildModalDirection', () => {
  it('accepts the two modal directions', () => {
    expect(isRebuildModalDirection('modernize')).toBe(true)
    expect(isRebuildModalDirection('keep-similar')).toBe(true)
  })

  it('rejects other design directions and junk', () => {
    expect(isRebuildModalDirection('simplify')).toBe(false)
    expect(isRebuildModalDirection('bold')).toBe(false)
    expect(isRebuildModalDirection(null)).toBe(false)
    expect(isRebuildModalDirection('')).toBe(false)
  })
})
