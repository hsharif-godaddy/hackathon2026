import { create } from 'zustand'

interface BillingModeState {
  modes: Record<string, boolean>
  setMode: (siteId: string, enabled: boolean) => void
  clearMode: (siteId: string) => void
}

export const useBillingModeStore = create<BillingModeState>((set) => ({
  modes: {},
  setMode: (siteId: string, enabled: boolean): void => {
    set((state) => ({
      modes: { ...state.modes, [siteId]: enabled },
    }))
  },
  clearMode: (siteId: string): void => {
    set((state) => {
      const { [siteId]: _, ...rest } = state.modes
      return { modes: rest }
    })
  },
}))

export function useResolvedBillingMode(siteId: string | undefined): boolean | undefined {
  return useBillingModeStore((state) => (siteId ? state.modes[siteId] : undefined))
}
