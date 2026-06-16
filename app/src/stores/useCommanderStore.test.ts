/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'

import { CanvasId, DEFAULT_OPEN_CANVAS_IDS, PINNED_CANVAS_ID } from '@/app/[market]/commander/canvas/registry'
import { CommanderPosition } from '@/app/[market]/commander/types'
import {
  PILL_DEFAULT_HEIGHT,
  PILL_MAX_HEIGHT,
  PILL_MIN_HEIGHT,
  sanitizeCanvasIds,
  sanitizePillHeight,
  sanitizePosition,
  useCommanderStore,
} from './useCommanderStore'

describe('useCommanderStore canvas tabs state', () => {
  beforeEach(() => {
    act(() => {
      useCommanderStore.setState({
        position: CommanderPosition.LeftDock,
        pillHeight: PILL_DEFAULT_HEIGHT,
        isCanvasSettingsOpen: false,
        openCanvasIds: [...DEFAULT_OPEN_CANVAS_IDS],
        activeCanvasId: PINNED_CANVAS_ID,
      })
    })
  })

  it('initializes with default open canvases and pinned active id', () => {
    const state = useCommanderStore.getState()
    expect(state.openCanvasIds).toEqual([...DEFAULT_OPEN_CANVAS_IDS])
    expect(state.activeCanvasId).toBe(PINNED_CANVAS_ID)
  })

  describe('openCanvas', () => {
    it('appends a new canvas and activates it', () => {
      act(() => {
        useCommanderStore.getState().openCanvas(CanvasId.SettingsSecurity)
      })
      const state = useCommanderStore.getState()
      expect(state.openCanvasIds).toContain(CanvasId.SettingsSecurity)
      expect(state.activeCanvasId).toBe(CanvasId.SettingsSecurity)
    })

    it('reactivates an already-open canvas without duplicating it', () => {
      act(() => {
        useCommanderStore.getState().setActiveCanvas(CanvasId.Brand)
        useCommanderStore.getState().openCanvas(CanvasId.Preview)
      })
      const state = useCommanderStore.getState()
      const previewOccurrences = state.openCanvasIds.filter((id) => id === CanvasId.Preview).length
      expect(previewOccurrences).toBe(1)
      expect(state.activeCanvasId).toBe(CanvasId.Preview)
    })

    it('rejects unknown canvas ids without mutating state', () => {
      const before = useCommanderStore.getState().openCanvasIds
      act(() => {
        useCommanderStore.getState().openCanvas('not-a-real-canvas' as CanvasId)
      })
      const after = useCommanderStore.getState()
      expect(after.openCanvasIds).toBe(before)
      expect(after.activeCanvasId).toBe(PINNED_CANVAS_ID)
    })
  })

  describe('closeCanvas', () => {
    it('refuses to close the pinned Preview canvas', () => {
      act(() => {
        useCommanderStore.getState().closeCanvas(PINNED_CANVAS_ID)
      })
      const state = useCommanderStore.getState()
      expect(state.openCanvasIds).toContain(PINNED_CANVAS_ID)
    })

    it('removes a non-pinned canvas and falls back to the prior tab when active', () => {
      act(() => {
        useCommanderStore.getState().openCanvas(CanvasId.SettingsSecurity)
        useCommanderStore.getState().closeCanvas(CanvasId.SettingsSecurity)
      })
      const state = useCommanderStore.getState()
      expect(state.openCanvasIds).not.toContain(CanvasId.SettingsSecurity)
      // Domain was the prior open canvas before opening SettingsSecurity
      expect(state.activeCanvasId).toBe(CanvasId.Domain)
    })

    it('preserves the active tab when closing a background tab', () => {
      act(() => {
        useCommanderStore.getState().openCanvas(CanvasId.Code)
        useCommanderStore.getState().setActiveCanvas(PINNED_CANVAS_ID)
        useCommanderStore.getState().closeCanvas(CanvasId.Code)
      })
      const state = useCommanderStore.getState()
      expect(state.activeCanvasId).toBe(PINNED_CANVAS_ID)
      expect(state.openCanvasIds).not.toContain(CanvasId.Code)
    })

    it('falls back to the left neighbor when closing the active tab in the middle', () => {
      // Default open: [Preview, Brand, Domain]. Activate Brand and close it.
      act(() => {
        useCommanderStore.getState().setActiveCanvas(CanvasId.Brand)
        useCommanderStore.getState().closeCanvas(CanvasId.Brand)
      })
      const state = useCommanderStore.getState()
      expect(state.openCanvasIds).not.toContain(CanvasId.Brand)
      expect(state.activeCanvasId).toBe(CanvasId.Preview)
    })

    it('falls back to the left neighbor when closing the active tab at the end', () => {
      // Default open: [Preview, Brand, Domain]. Activate Domain (last) and close it.
      act(() => {
        useCommanderStore.getState().setActiveCanvas(CanvasId.Domain)
        useCommanderStore.getState().closeCanvas(CanvasId.Domain)
      })
      const state = useCommanderStore.getState()
      expect(state.openCanvasIds).not.toContain(CanvasId.Domain)
      expect(state.activeCanvasId).toBe(CanvasId.Brand)
    })
  })

  describe('setActiveCanvas', () => {
    it('only activates canvases that are currently open', () => {
      act(() => {
        useCommanderStore.getState().setActiveCanvas(CanvasId.SettingsSecurity)
      })
      const state = useCommanderStore.getState()
      // SettingsSecurity is not in default-open list; activation should be ignored
      expect(state.activeCanvasId).toBe(PINNED_CANVAS_ID)
    })

    it('activates an open canvas', () => {
      act(() => {
        useCommanderStore.getState().setActiveCanvas(CanvasId.Brand)
      })
      const state = useCommanderStore.getState()
      expect(state.activeCanvasId).toBe(CanvasId.Brand)
    })
  })
})

describe('useCommanderStore persist sanitizers', () => {
  describe('sanitizeCanvasIds', () => {
    it('returns defaults when input is not an array', () => {
      expect(sanitizeCanvasIds(null)).toEqual([...DEFAULT_OPEN_CANVAS_IDS])
      expect(sanitizeCanvasIds(undefined)).toEqual([...DEFAULT_OPEN_CANVAS_IDS])
      expect(sanitizeCanvasIds('preview' as unknown)).toEqual([...DEFAULT_OPEN_CANVAS_IDS])
      expect(sanitizeCanvasIds({ 0: CanvasId.Preview })).toEqual([...DEFAULT_OPEN_CANVAS_IDS])
    })

    it('drops invalid ids and unknown strings', () => {
      const result = sanitizeCanvasIds([CanvasId.Preview, 'not-a-canvas', 42, null, CanvasId.Code])
      expect(result).toEqual([CanvasId.Preview, CanvasId.Code])
    })

    it('returns an array containing pinned id even when input has all-invalid entries', () => {
      const result = sanitizeCanvasIds(['nope', 99, undefined])
      expect(result[0]).toBe(PINNED_CANVAS_ID)
      expect(result).toContain(PINNED_CANVAS_ID)
    })

    it('prepends pinned id when missing', () => {
      const result = sanitizeCanvasIds([CanvasId.Brand, CanvasId.Code])
      expect(result[0]).toBe(PINNED_CANVAS_ID)
      expect(result).toEqual([PINNED_CANVAS_ID, CanvasId.Brand, CanvasId.Code])
    })

    it('removes duplicates while keeping pinned first', () => {
      const result = sanitizeCanvasIds([
        CanvasId.Brand,
        CanvasId.Preview,
        CanvasId.Brand,
        CanvasId.Code,
        CanvasId.Code,
      ])
      expect(result).toEqual([PINNED_CANVAS_ID, CanvasId.Brand, CanvasId.Code])
    })
  })

  describe('sanitizePillHeight', () => {
    it('clamps heights below the minimum', () => {
      expect(sanitizePillHeight(0)).toBe(PILL_MIN_HEIGHT)
      expect(sanitizePillHeight(-100)).toBe(PILL_MIN_HEIGHT)
    })

    it('clamps heights above the maximum', () => {
      expect(sanitizePillHeight(99999)).toBe(PILL_MAX_HEIGHT)
    })

    it('returns the default for non-finite or non-number values', () => {
      expect(sanitizePillHeight(NaN)).toBe(PILL_DEFAULT_HEIGHT)
      expect(sanitizePillHeight(Infinity)).toBe(PILL_DEFAULT_HEIGHT)
      expect(sanitizePillHeight(undefined)).toBe(PILL_DEFAULT_HEIGHT)
      expect(sanitizePillHeight('420' as unknown)).toBe(PILL_DEFAULT_HEIGHT)
    })

    it('returns valid in-range heights unchanged', () => {
      expect(sanitizePillHeight(420)).toBe(420)
    })
  })

  describe('sanitizePosition', () => {
    it('returns LeftDock for unknown strings or non-strings', () => {
      expect(sanitizePosition('off-the-grid')).toBe(CommanderPosition.LeftDock)
      expect(sanitizePosition(undefined)).toBe(CommanderPosition.LeftDock)
      expect(sanitizePosition(123)).toBe(CommanderPosition.LeftDock)
    })

    it('passes through valid CommanderPosition values', () => {
      expect(sanitizePosition(CommanderPosition.Floating)).toBe(CommanderPosition.Floating)
      expect(sanitizePosition(CommanderPosition.Collapsed)).toBe(CommanderPosition.Collapsed)
    })
  })
})

describe('useCommanderStore persist rehydration', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const STORAGE_KEY = 'airo-builder.commander.v1'

  const seedStorage = (state: unknown) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }))
  }

  it('falls back to PINNED when persisted activeCanvasId is missing from open ids', async () => {
    seedStorage({
      openCanvasIds: [CanvasId.Preview, CanvasId.Code],
      activeCanvasId: CanvasId.Brand,
    })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().activeCanvasId).toBe(PINNED_CANVAS_ID)
    expect(useCommanderStore.getState().openCanvasIds).toEqual([CanvasId.Preview, CanvasId.Code])
  })

  it('replaces a non-array openCanvasIds with defaults', async () => {
    seedStorage({ openCanvasIds: 'corrupt', activeCanvasId: CanvasId.Brand })
    await useCommanderStore.persist.rehydrate()
    const state = useCommanderStore.getState()
    expect(state.openCanvasIds).toEqual([...DEFAULT_OPEN_CANVAS_IDS])
  })

  it('clamps a corrupt persisted pillHeight', async () => {
    seedStorage({ pillHeight: 'tall', activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().pillHeight).toBe(PILL_DEFAULT_HEIGHT)
  })

  it('clamps an out-of-range pillHeight', async () => {
    seedStorage({ pillHeight: 9999, activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().pillHeight).toBe(PILL_MAX_HEIGHT)
  })

  it('replaces an unknown position with LeftDock', async () => {
    seedStorage({ position: 'mars', activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().position).toBe(CommanderPosition.LeftDock)
  })

  it('keeps a valid persisted position', async () => {
    seedStorage({ position: CommanderPosition.Floating, activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().position).toBe(CommanderPosition.Floating)
  })
})
