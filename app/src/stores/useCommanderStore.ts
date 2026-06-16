import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  CANVAS_REGISTRY,
  CanvasId,
  COMMANDER_CANVAS_TABS_FLAG,
  DEFAULT_OPEN_CANVAS_IDS,
  PINNED_CANVAS_ID,
} from '@/app/[market]/commander/canvas/registry'
import { CommanderPosition } from '@/app/[market]/commander/types'
import { useSwitchboard } from '@/hooks/useSwitchboard'

const POSITION_ORDER: readonly CommanderPosition[] = [
  CommanderPosition.LeftDock,
  CommanderPosition.Collapsed,
  CommanderPosition.Floating,
] as const

export const PILL_MIN_HEIGHT = 144
export const PILL_MAX_HEIGHT = 800
export const PILL_DEFAULT_HEIGHT = 420

export const clampPillHeight = (h: number): number =>
  Math.max(PILL_MIN_HEIGHT, Math.min(PILL_MAX_HEIGHT, h))

export const COMMANDER_FLOATMODES_FLAG = 'appbuilder-commander-floatmodes'
export const COMMANDER_CANVAS_FLAG = 'appbuilder-commander-canvas'

export function useCommanderFloatModesEnabled(): boolean {
  return useSwitchboard(COMMANDER_FLOATMODES_FLAG) === true
}

export function useCommanderCanvasEnabled(): boolean {
  return useSwitchboard(COMMANDER_CANVAS_FLAG) === true
}

export function useCommanderCanvasTabsEnabled(): boolean {
  return useSwitchboard(COMMANDER_CANVAS_TABS_FLAG) === true
}

export function useEffectiveCommanderPosition(): CommanderPosition {
  const position = useCommanderStore((state) => state.position)
  const floatModesEnabled = useCommanderFloatModesEnabled()
  return floatModesEnabled ? position : CommanderPosition.LeftDock
}

interface CommanderStore {
  position: CommanderPosition
  pillHeight: number
  isCanvasSettingsOpen: boolean
  openCanvasIds: CanvasId[]
  activeCanvasId: CanvasId
  setPosition: (position: CommanderPosition) => void
  cyclePosition: () => void
  setPillHeight: (height: number) => void
  openCanvasSettings: () => void
  closeCanvasSettings: () => void
  openCanvas: (canvasId: CanvasId) => void
  closeCanvas: (canvasId: CanvasId) => void
  setActiveCanvas: (canvasId: CanvasId) => void
}

export const sanitizeCanvasIds = (ids: unknown): CanvasId[] => {
  if (!Array.isArray(ids)) return [...DEFAULT_OPEN_CANVAS_IDS]
  const validIds = ids.filter((id): id is CanvasId =>
    typeof id === 'string' && id in CANVAS_REGISTRY,
  )
  if (!validIds.includes(PINNED_CANVAS_ID)) {
    return [PINNED_CANVAS_ID, ...validIds.filter((id) => id !== PINNED_CANVAS_ID)]
  }
  const pinnedFirst = [PINNED_CANVAS_ID, ...validIds.filter((id) => id !== PINNED_CANVAS_ID)]
  return Array.from(new Set(pinnedFirst))
}

const VALID_POSITIONS: ReadonlySet<CommanderPosition> = new Set(POSITION_ORDER)

export const sanitizePillHeight = (height: unknown): number =>
  typeof height === 'number' && Number.isFinite(height)
    ? clampPillHeight(height)
    : PILL_DEFAULT_HEIGHT

export const sanitizePosition = (position: unknown): CommanderPosition =>
  VALID_POSITIONS.has(position as CommanderPosition)
    ? (position as CommanderPosition)
    : CommanderPosition.LeftDock

export const useCommanderStore = create<CommanderStore>()(
  persist(
    (set, get) => ({
      position: CommanderPosition.LeftDock,
      pillHeight: PILL_DEFAULT_HEIGHT,
      isCanvasSettingsOpen: false,
      openCanvasIds: [...DEFAULT_OPEN_CANVAS_IDS],
      activeCanvasId: PINNED_CANVAS_ID,
      setPosition: (position) => set({ position }),
      cyclePosition: () => {
        const current = get().position
        const idx = POSITION_ORDER.indexOf(current)
        set({ position: POSITION_ORDER[(idx + 1) % POSITION_ORDER.length] })
      },
      setPillHeight: (height) => set({ pillHeight: clampPillHeight(height) }),
      openCanvasSettings: () => set({ isCanvasSettingsOpen: true }),
      closeCanvasSettings: () => set({ isCanvasSettingsOpen: false }),
      openCanvas: (canvasId) => set((state) => {
        if (!CANVAS_REGISTRY[canvasId]) return state
        const isAlreadyOpen = state.openCanvasIds.includes(canvasId)
        return {
          openCanvasIds: isAlreadyOpen ? state.openCanvasIds : [...state.openCanvasIds, canvasId],
          activeCanvasId: canvasId,
        }
      }),
      closeCanvas: (canvasId) => set((state) => {
        if (canvasId === PINNED_CANVAS_ID) return state
        if (!state.openCanvasIds.includes(canvasId)) return state
        const nextOpen = state.openCanvasIds.filter((id) => id !== canvasId)
        const wasActive = state.activeCanvasId === canvasId
        if (!wasActive) return { ...state, openCanvasIds: nextOpen }
        const closedIndex = state.openCanvasIds.indexOf(canvasId)
        const leftNeighbor = closedIndex > 0 ? state.openCanvasIds[closedIndex - 1] : undefined
        const fallback = leftNeighbor ?? PINNED_CANVAS_ID
        return { ...state, openCanvasIds: nextOpen, activeCanvasId: fallback }
      }),
      setActiveCanvas: (canvasId) => set((state) => {
        if (!state.openCanvasIds.includes(canvasId)) return state
        return { ...state, activeCanvasId: canvasId }
      }),
    }),
    {
      name: 'airo-builder.commander.v1',
      partialize: (state) => ({
        position: state.position,
        pillHeight: state.pillHeight,
        openCanvasIds: state.openCanvasIds,
        activeCanvasId: state.activeCanvasId,
      }),
      merge: (persisted, current) => {
        const persistedShape = (persisted ?? {}) as Partial<CommanderStore>
        const sanitizedOpen = sanitizeCanvasIds(persistedShape.openCanvasIds)
        const persistedActive = persistedShape.activeCanvasId
        const activeCanvasId =
          typeof persistedActive === 'string' && sanitizedOpen.includes(persistedActive as CanvasId)
            ? (persistedActive as CanvasId)
            : PINNED_CANVAS_ID
        return {
          ...current,
          position: sanitizePosition(persistedShape.position),
          pillHeight: sanitizePillHeight(persistedShape.pillHeight),
          openCanvasIds: sanitizedOpen,
          activeCanvasId,
        } as CommanderStore
      },
    },
  ),
)
