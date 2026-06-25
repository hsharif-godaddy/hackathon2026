import { create } from 'zustand'

/**
 * Design Kit Wizard phase (AIROBUILD-2679 Phase 2; extended in AIROBUILD-2855).
 * - `gathering`: chat-only, app chrome hidden, agent gathers core info + suggests vibes.
 * - `brand`: chat docks left, the "Building Your Brand" progress panel fills as the agent
 *   assembles the kit (was `working`; the manual build/refine buttons are gone — the flow is
 *   agent-driven and immersive now).
 * - `website`: the agent has handed off and the website is building (chat still left).
 * - `ready`: the website build has completed; the full builder is revealed.
 */
export type WizardPhase = 'gathering' | 'brand' | 'website' | 'ready'

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
