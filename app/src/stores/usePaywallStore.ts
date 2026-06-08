import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface PaywallState {
  showUpgradeModal: boolean
  upgradeModalSource: string | null
  upgradeModalItc: string | null
  showCreditsModal: boolean
  creditsModalSource: string | null
  creditsModalItc: string | null
  paywallLoading: boolean
}

interface PaywallActions {
  openUpgradeModal: (source: string, itc?: string) => void
  closeUpgradeModal: () => void
  openCreditsModal: (source: string, itc?: string) => void
  closeCreditsModal: () => void
  setPaywallLoading: (loading: boolean) => void
}

type PaywallStore = PaywallState & PaywallActions

export const usePaywallStore = create<PaywallStore>()(
  immer((set, get) => ({
    showUpgradeModal: false,
    upgradeModalSource: null,
    upgradeModalItc: null,
    showCreditsModal: false,
    creditsModalSource: null,
    creditsModalItc: null,
    paywallLoading: false,

    openUpgradeModal: (source: string, itc?: string) => {
      if (get().paywallLoading) return
      set((state) => {
        state.showUpgradeModal = true
        state.upgradeModalSource = source
        state.upgradeModalItc = itc ?? null
        state.paywallLoading = true
      })
    },
    closeUpgradeModal: () => set((state) => {
      state.showUpgradeModal = false
      state.upgradeModalSource = null
      state.upgradeModalItc = null
      state.paywallLoading = false
    }),
    openCreditsModal: (source: string, itc?: string) => {
      if (get().paywallLoading) return
      set((state) => {
        state.showCreditsModal = true
        state.creditsModalSource = source
        state.creditsModalItc = itc ?? null
        state.paywallLoading = true
      })
    },
    closeCreditsModal: () => set((state) => {
      state.showCreditsModal = false
      state.creditsModalSource = null
      state.creditsModalItc = null
      state.paywallLoading = false
    }),
    setPaywallLoading: (loading: boolean) => set((state) => {
      state.paywallLoading = loading
    }),
  }))
)
