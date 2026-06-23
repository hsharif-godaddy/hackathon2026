import { create } from 'zustand'

/**
 * Design Kit Wizard phase (AIROBUILD-2679 Phase 2 — replaces the 1–5 step machine).
 * - `gathering`: chat-only, app chrome hidden, agent gathers core info + assembles the kit.
 * - `working`: brand cards + showcase shown; user refines and triggers the build.
 * - `ready`: the website build has completed; the full builder is revealed.
 */
export type WizardPhase = 'gathering' | 'working' | 'ready'

interface WizardState {
  /** Per-app current phase. Key = appId. */
  phaseByApp: Record<string, WizardPhase>
  setPhase: (appId: string, phase: WizardPhase) => void
  getPhase: (appId: string) => WizardPhase | undefined
}

export const useWizardStore = create<WizardState>((set, get) => ({
  phaseByApp: {},
  setPhase: (appId, phase) =>
    set((state) => ({ phaseByApp: { ...state.phaseByApp, [appId]: phase } })),
  getPhase: (appId) => get().phaseByApp[appId],
}))
