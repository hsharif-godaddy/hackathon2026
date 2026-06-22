import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// A publish-after-upgrade arm only spans one purchase round-trip (See Plans -> pay -> return).
// 30 min comfortably covers entering payment details; past it the arm is treated as abandoned and
// dropped on rehydration, so it can't auto-open publish on a later, unrelated paid-state flip.
const PUBLISH_OPEN_AFTER_UPGRADE_TTL_MS = 30 * 60 * 1000

interface PaywallState {
  showUpgradeModal: boolean
  upgradeModalSource: string | null
  upgradeModalItc: string | null
  showCreditsModal: boolean
  creditsModalSource: string | null
  creditsModalItc: string | null
  paywallLoading: boolean
  // App id armed by the combine-upgrade-with-publish upsell. When the armed app becomes paid,
  // AppPublish auto-opens its publish popover (see usePublishUpsellEligibility / AppPublish).
  publishOpenAfterUpgradeAppId: string | null
  // Wall-clock ms when the arm above was set. Persisted alongside the arm and used ONLY to expire a
  // stale arm on rehydration (sessionStorage survives reloads). null when not armed.
  publishOpenAfterUpgradeArmedAt: number | null
}

interface PaywallActions {
  openUpgradeModal: (source: string, itc?: string) => void
  closeUpgradeModal: () => void
  openCreditsModal: (source: string, itc?: string) => void
  closeCreditsModal: () => void
  setPaywallLoading: (loading: boolean) => void
  armPublishOpenAfterUpgrade: (appId: string) => void
  clearPublishOpenAfterUpgrade: () => void
}

type PaywallStore = PaywallState & PaywallActions

export const usePaywallStore = create<PaywallStore>()(
  persist(
    immer((set, get) => ({
    showUpgradeModal: false,
    upgradeModalSource: null,
    upgradeModalItc: null,
    showCreditsModal: false,
    creditsModalSource: null,
    creditsModalItc: null,
    paywallLoading: false,
    publishOpenAfterUpgradeAppId: null,
    publishOpenAfterUpgradeArmedAt: null,

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
    // Note: closeUpgradeModal intentionally does NOT clear the arm — DirectToPaidContainer fires
    // its onClose on a successful purchase too, so clearing on close would drop the intent before
    // the paid-state flip. The arm is cleared on consume (AppPublish) and on app-id change.
    armPublishOpenAfterUpgrade: (appId: string) => set((state) => {
      state.publishOpenAfterUpgradeAppId = appId
      state.publishOpenAfterUpgradeArmedAt = Date.now()
    }),
    clearPublishOpenAfterUpgrade: () => set((state) => {
      state.publishOpenAfterUpgradeAppId = null
      state.publishOpenAfterUpgradeArmedAt = null
    }),
  })),
  {
    name: 'aab-paywall-arm',
    // SSR-safe: no-op storage on the server; sessionStorage scopes the arm to the tab session.
    storage: createJSONStorage(() =>
      typeof window !== 'undefined'
        ? window.sessionStorage
        : { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    ),
    // Persist ONLY the auto-open arm + its timestamp — never the transient modal/loading state.
    partialize: (state) => ({
      publishOpenAfterUpgradeAppId: state.publishOpenAfterUpgradeAppId,
      publishOpenAfterUpgradeArmedAt: state.publishOpenAfterUpgradeArmedAt,
    }),
    // Drop a stale (or timestamp-less) arm at rehydration so an abandoned purchase can't auto-open
    // publish on a later paid-state flip. Spread `current` first so the action functions survive.
    merge: (persisted, current) => {
      const saved = (persisted ?? {}) as Partial<PaywallState>
      const armedAt = saved.publishOpenAfterUpgradeArmedAt ?? null
      const isFresh =
        armedAt !== null && Date.now() - armedAt < PUBLISH_OPEN_AFTER_UPGRADE_TTL_MS
      return {
        ...current,
        publishOpenAfterUpgradeAppId: isFresh ? saved.publishOpenAfterUpgradeAppId ?? null : null,
        publishOpenAfterUpgradeArmedAt: isFresh ? armedAt : null,
      }
    },
  },
  )
)
