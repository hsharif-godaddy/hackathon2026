/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'

import { CanvasId, DEFAULT_OPEN_CANVAS_IDS, PINNED_CANVAS_ID } from '@/app/[market]/commander/canvas/registry'
import { CommanderPosition, FloatingAnchor } from '@/app/[market]/commander/types'
import {
  clampFloatingWidth,
  DEFAULT_FLOATING_WIDTH_BY_ANCHOR,
  FLOATING_CENTER_DEFAULT_WIDTH,
  FLOATING_SIDE_DEFAULT_WIDTH,
  PILL_DEFAULT_HEIGHT,
  PILL_MAX_HEIGHT,
  PILL_MIN_HEIGHT,
  sanitizeCanvasIds,
  sanitizeFloatingAnchor,
  sanitizeFloatingWidthByAnchor,
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
      expect(sanitizePosition(CommanderPosition.LeftDock)).toBe(CommanderPosition.LeftDock)
      expect(sanitizePosition(CommanderPosition.Floating)).toBe(CommanderPosition.Floating)
    })

    it('migrates legacy "collapsed" position to Floating', () => {
      expect(sanitizePosition('collapsed')).toBe(CommanderPosition.Floating)
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

  it('rehydrates isCollapsed=true when persisted as true', async () => {
    seedStorage({ isCollapsed: true, activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().isCollapsed).toBe(true)
  })

  it('coerces non-boolean isCollapsed to false', async () => {
    seedStorage({ isCollapsed: 'yes', activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().isCollapsed).toBe(false)
  })

  it('defaults isCollapsed to false when missing from persisted state', async () => {
    seedStorage({ activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().isCollapsed).toBe(false)
  })

  it('migrates legacy persisted "collapsed" position to Floating on rehydrate', async () => {
    seedStorage({ position: 'collapsed', activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().position).toBe(CommanderPosition.Floating)
  })

  it('rehydrates a persisted floatingAnchor', async () => {
    seedStorage({ floatingAnchor: FloatingAnchor.BottomLeft, activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().floatingAnchor).toBe(FloatingAnchor.BottomLeft)
  })

  it('defaults floatingAnchor to BottomCenter when persisted value is invalid', async () => {
    seedStorage({ floatingAnchor: 'top-galactic', activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().floatingAnchor).toBe(FloatingAnchor.BottomCenter)
  })

  it('rehydrates persisted floatingWidthByAnchor entries', async () => {
    seedStorage({
      floatingWidthByAnchor: {
        [FloatingAnchor.BottomLeft]: 500,
        [FloatingAnchor.BottomCenter]: 900,
        [FloatingAnchor.BottomRight]: 480,
      },
      activeCanvasId: PINNED_CANVAS_ID,
    })
    await useCommanderStore.persist.rehydrate()
    const widths = useCommanderStore.getState().floatingWidthByAnchor
    expect(widths[FloatingAnchor.BottomLeft]).toBe(500)
    expect(widths[FloatingAnchor.BottomCenter]).toBe(900)
    expect(widths[FloatingAnchor.BottomRight]).toBe(480)
  })

  it('falls back to per-anchor defaults when persisted floatingWidthByAnchor is missing', async () => {
    seedStorage({ activeCanvasId: PINNED_CANVAS_ID })
    await useCommanderStore.persist.rehydrate()
    expect(useCommanderStore.getState().floatingWidthByAnchor).toEqual(DEFAULT_FLOATING_WIDTH_BY_ANCHOR)
  })

  it('drops below-minimum and non-finite floatingWidthByAnchor entries to per-anchor defaults', async () => {
    seedStorage({
      floatingWidthByAnchor: {
        [FloatingAnchor.BottomLeft]: 10,
        [FloatingAnchor.BottomCenter]: 'wide',
        [FloatingAnchor.BottomRight]: 480,
      },
      activeCanvasId: PINNED_CANVAS_ID,
    })
    await useCommanderStore.persist.rehydrate()
    const widths = useCommanderStore.getState().floatingWidthByAnchor
    expect(widths[FloatingAnchor.BottomLeft]).toBe(FLOATING_SIDE_DEFAULT_WIDTH)
    expect(widths[FloatingAnchor.BottomCenter]).toBe(FLOATING_CENTER_DEFAULT_WIDTH)
    expect(widths[FloatingAnchor.BottomRight]).toBe(480)
  })
})

describe('useCommanderStore floating-anchor state and actions', () => {
  beforeEach(() => {
    act(() => {
      useCommanderStore.setState({
        position: CommanderPosition.LeftDock,
        floatingAnchor: FloatingAnchor.BottomCenter,
        floatingWidthByAnchor: { ...DEFAULT_FLOATING_WIDTH_BY_ANCHOR },
      })
    })
  })

  it('initializes floatingAnchor to BottomCenter and widths to per-anchor defaults', () => {
    const state = useCommanderStore.getState()
    expect(state.floatingAnchor).toBe(FloatingAnchor.BottomCenter)
    expect(state.floatingWidthByAnchor).toEqual(DEFAULT_FLOATING_WIDTH_BY_ANCHOR)
  })

  it('setFloatingAnchor updates the anchor without touching widths', () => {
    act(() => {
      useCommanderStore.getState().setFloatingAnchor(FloatingAnchor.BottomLeft)
    })
    const state = useCommanderStore.getState()
    expect(state.floatingAnchor).toBe(FloatingAnchor.BottomLeft)
    expect(state.floatingWidthByAnchor).toEqual(DEFAULT_FLOATING_WIDTH_BY_ANCHOR)
  })

  it('setFloatingWidth only updates the width for the target anchor', () => {
    act(() => {
      useCommanderStore.getState().setFloatingWidth(FloatingAnchor.BottomLeft, 555)
    })
    const widths = useCommanderStore.getState().floatingWidthByAnchor
    expect(widths[FloatingAnchor.BottomLeft]).toBe(555)
    expect(widths[FloatingAnchor.BottomCenter]).toBe(FLOATING_CENTER_DEFAULT_WIDTH)
    expect(widths[FloatingAnchor.BottomRight]).toBe(FLOATING_SIDE_DEFAULT_WIDTH)
  })

  it('resetFloatingWidth restores only the target anchor to its default', () => {
    act(() => {
      useCommanderStore.getState().setFloatingWidth(FloatingAnchor.BottomCenter, 999)
      useCommanderStore.getState().setFloatingWidth(FloatingAnchor.BottomLeft, 500)
      useCommanderStore.getState().resetFloatingWidth(FloatingAnchor.BottomCenter)
    })
    const widths = useCommanderStore.getState().floatingWidthByAnchor
    expect(widths[FloatingAnchor.BottomCenter]).toBe(FLOATING_CENTER_DEFAULT_WIDTH)
    expect(widths[FloatingAnchor.BottomLeft]).toBe(500)
  })

  it('cyclePosition toggles between LeftDock and Floating only', () => {
    expect(useCommanderStore.getState().position).toBe(CommanderPosition.LeftDock)
    act(() => useCommanderStore.getState().cyclePosition())
    expect(useCommanderStore.getState().position).toBe(CommanderPosition.Floating)
    act(() => useCommanderStore.getState().cyclePosition())
    expect(useCommanderStore.getState().position).toBe(CommanderPosition.LeftDock)
  })
})

describe('useCommanderStore floating sanitizers', () => {
  describe('sanitizeFloatingAnchor', () => {
    it('passes through valid FloatingAnchor values', () => {
      expect(sanitizeFloatingAnchor(FloatingAnchor.BottomLeft)).toBe(FloatingAnchor.BottomLeft)
      expect(sanitizeFloatingAnchor(FloatingAnchor.BottomCenter)).toBe(FloatingAnchor.BottomCenter)
      expect(sanitizeFloatingAnchor(FloatingAnchor.BottomRight)).toBe(FloatingAnchor.BottomRight)
    })

    it('falls back to BottomCenter for invalid values', () => {
      expect(sanitizeFloatingAnchor('top-left')).toBe(FloatingAnchor.BottomCenter)
      expect(sanitizeFloatingAnchor(undefined)).toBe(FloatingAnchor.BottomCenter)
      expect(sanitizeFloatingAnchor(42)).toBe(FloatingAnchor.BottomCenter)
    })
  })

  describe('sanitizeFloatingWidthByAnchor', () => {
    it('returns defaults when input is missing or non-object', () => {
      expect(sanitizeFloatingWidthByAnchor(null)).toEqual(DEFAULT_FLOATING_WIDTH_BY_ANCHOR)
      expect(sanitizeFloatingWidthByAnchor(undefined)).toEqual(DEFAULT_FLOATING_WIDTH_BY_ANCHOR)
      expect(sanitizeFloatingWidthByAnchor('width')).toEqual(DEFAULT_FLOATING_WIDTH_BY_ANCHOR)
    })

    it('keeps valid per-anchor entries and replaces invalid ones with defaults', () => {
      const result = sanitizeFloatingWidthByAnchor({
        [FloatingAnchor.BottomLeft]: 500,
        [FloatingAnchor.BottomCenter]: 'too wide',
        [FloatingAnchor.BottomRight]: -50,
      })
      expect(result[FloatingAnchor.BottomLeft]).toBe(500)
      expect(result[FloatingAnchor.BottomCenter]).toBe(FLOATING_CENTER_DEFAULT_WIDTH)
      expect(result[FloatingAnchor.BottomRight]).toBe(FLOATING_SIDE_DEFAULT_WIDTH)
    })

    it('rejects widths below the anchor-specific default', () => {
      // 500 is above the 406 side default but below the 680 center default
      const result = sanitizeFloatingWidthByAnchor({
        [FloatingAnchor.BottomLeft]: 500,
        [FloatingAnchor.BottomCenter]: 500,
        [FloatingAnchor.BottomRight]: 500,
      })
      expect(result[FloatingAnchor.BottomLeft]).toBe(500)
      expect(result[FloatingAnchor.BottomCenter]).toBe(FLOATING_CENTER_DEFAULT_WIDTH)
      expect(result[FloatingAnchor.BottomRight]).toBe(500)
    })
  })

  describe('clampFloatingWidth', () => {
    it('returns the width unchanged when within range', () => {
      expect(clampFloatingWidth(500, 406, 1200)).toBe(500)
    })

    it('clamps to the provided minWidth when below', () => {
      expect(clampFloatingWidth(100, 406, 1200)).toBe(406)
    })

    it('clamps to the provided maxWidth when above', () => {
      expect(clampFloatingWidth(2000, 406, 800)).toBe(800)
    })

    it('honors minWidth even when maxWidth is below it', () => {
      expect(clampFloatingWidth(2000, 406, 100)).toBe(406)
    })
  })
})
