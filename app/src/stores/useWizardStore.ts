import { create } from 'zustand'

export type WizardStep = 1 | 2 | 3 | 4 | 5

interface WizardState {
  /** Per-app current step. Key = appId. */
  stepByApp: Record<string, WizardStep>
  setStep: (appId: string, step: WizardStep) => void
  getStep: (appId: string) => WizardStep | undefined
  /**
   * Per-app flag: the step-5 launch sequence has played and handed off to the
   * Edit tab once. Key = appId. Lets the wizard force the view switch only on
   * the first arrival at step 5 — revisiting the Logo & Brand tab afterwards
   * shows a calm "watch it build" panel instead of replaying + re-yanking.
   */
  handoffDoneByApp: Record<string, boolean>
  markHandoffDone: (appId: string) => void
}

export const useWizardStore = create<WizardState>((set, get) => ({
  stepByApp: {},
  setStep: (appId, step) =>
    set((state) => ({ stepByApp: { ...state.stepByApp, [appId]: step } })),
  getStep: (appId) => get().stepByApp[appId],
  handoffDoneByApp: {},
  markHandoffDone: (appId) =>
    set((state) => ({ handoffDoneByApp: { ...state.handoffDoneByApp, [appId]: true } })),
}))
