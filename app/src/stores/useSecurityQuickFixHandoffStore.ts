import { create } from 'zustand';

interface SecurityQuickFixHandoffState {
  /** Incremented after a successful Quick Fix handoff so Security panel can drop cached analysis. */
  handoffCompleteNonce: number;
  /** Last `handoffCompleteNonce` SecurityPanel already reset UI for (avoids clearing on remount). */
  lastPanelResetNonce: number;
  markHandoffComplete: () => void;
  recordPanelReset: () => void;
}

export const useSecurityQuickFixHandoffStore = create<SecurityQuickFixHandoffState>((set, get) => ({
  handoffCompleteNonce: 0,
  lastPanelResetNonce: 0,
  markHandoffComplete: () =>
    set((state) => ({ handoffCompleteNonce: state.handoffCompleteNonce + 1 })),
  recordPanelReset: () =>
    set({ lastPanelResetNonce: get().handoffCompleteNonce }),
}));
