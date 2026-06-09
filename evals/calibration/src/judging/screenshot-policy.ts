export type ScreenshotPolicy = 'required' | 'not_required';

/**
 * Use-case based mapping: should this evaluator be judged with screenshots attached?
 *
 * This is intentionally explicit and deterministic (no keyword heuristics, no YAML flags).
 */
export const SCREENSHOT_POLICY_BY_EVALUATOR_ID: Record<string, ScreenshotPolicy> = {
  // Conversation/tooling only metrics
  'airo-ambiguity-handling-quality': 'not_required',
  'airo-flow-efficiency': 'not_required',
  'airo-intent-resolution-status': 'not_required',

  // DOM/text-first content metrics
  'airo-business-fit': 'not_required',
  'airo-content-quality': 'not_required',
  'airo-content-specificity': 'not_required',
  'airo-hero-section-presence': 'not_required',
  'airo-navigation-presence': 'not_required',
  'airo-primary-cta-presence': 'not_required',
  'airo-scope-drift-overgeneration': 'not_required',

  // Artifact + presentation/visual prominence metrics
  'airo-conversion-path-clarity': 'required',
  'airo-task-completion-status': 'required',
  'airo-usability': 'required',
  'airo-visual-layout-sanity': 'required',
  'airo-visual-quality': 'required',

  // Artifact verification metrics (claims vs what is visible)
  'airo-conversation-to-artifact-consistency': 'required',
  'airo-silent-hallucination': 'required',

  // Structural alignment where layout/visual evidence helps validate presence/placement
  'airo-intent-to-output-alignment': 'required',

  // Implied-features / trust cues often include visual blocks/badges; attach screenshots
  'airo-implicit-feature-gap': 'required',
  'airo-trust-signal-coverage': 'required',

  // Information architecture can be judged from DOM alone; screenshots not required
  'airo-structural-coherence': 'not_required',
};

export function shouldAttachScreenshots(evaluatorId: string): boolean {
  return SCREENSHOT_POLICY_BY_EVALUATOR_ID[evaluatorId] === 'required';
}

