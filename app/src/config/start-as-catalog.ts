/**
 * Start-as selection catalog — the list backing the internal home-page
 * "start a new app as…" picker (the `?profile=` / `?template=` / `?agent=`
 * overrides).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MAINTENANCE: this is a hand-curated, front-end-only list. When you add a new
 *   • profile        → `agents/src/profiles/<name>.json`
 *   • template (mode) → `agents/src/agents/mode-registry.ts` (`modeRegistry` / `getModeIds`)
 *   • agent           → `agents/src/agents/ai-lib-agents/index.ts` (factory agentDefinitions)
 * add a matching entry here so it shows up in the internal picker. It is NOT
 * auto-derived from those registries (they don't carry display labels, and the
 * home page can't reach the per-app agents service). Drift is safe, not a
 * correctness bug: the agents service independently validates a chosen agent id
 * against the live factory registry and a profile name via `resolveProfile`
 * (unknown → base initial), so a stale/extra entry here simply won't resolve —
 * it can never route to something unregistered.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two independent axes (see StartAsControls):
 *  - PROFILE (`kind: 'profile'`) — the proper abstraction. Sets JWT `agentProfile`
 *    (model + skills + develop config for the whole session + a default initial).
 *  - FREEZE OVERRIDE — pins the frozen initial agent, either by TEMPLATE
 *    (`?template=` → `initial-<id>`) or AGENT (`?agent=` → that exact id). Template
 *    and agent are the same axis (mutually exclusive; agent wins if both given).
 */

export type StartSelectionKind = 'profile' | 'template' | 'agent'

export interface StartSelection {
  kind: StartSelectionKind
  /** profile name (profile) | templateId (template) | agent id (agent). */
  value: string
  label: string
  description: string
}

export const START_SELECTIONS: readonly StartSelection[] = [
  // Profiles — the primary abstraction (session model/skills + default initial).
  { kind: 'profile', value: 'initial-agent-v3', label: 'Initial v3 (default)', description: 'Two-round questioning; current default.' },
  { kind: 'profile', value: 'initial-agent-v1', label: 'Initial v1 (legacy)', description: 'Single-round questioning.' },
  { kind: 'profile', value: 'prompt-enhancer', label: 'Prompt Enhancer', description: 'Large question set with a planning-first strategy.' },
  { kind: 'profile', value: 'initial-agent-design-system', label: 'Design System', description: 'Questions, then pick a design kit and build from it.' },
  { kind: 'profile', value: 'initial-agent-design-system-homepage-build', label: 'Design System (Homepage Build)', description: 'Design-kit profile tuned for faster homepage builds.' },
  { kind: 'profile', value: 'initial-agent-design-kit', label: 'Design Kit Wizard', description: 'Interactive design-kit wizard.' },
  { kind: 'profile', value: 'experimental', label: 'Experimental', description: 'Model + skill overrides for internal testing.' },

  // Templates — freeze `initial-<templateId>` (?mode=, legacy ?template=). NB the
  // homepage submit path only honors default/business-plan/logo-designer/deep-build
  // (validateTemplate); zip-import/ui-kit-import/file-upload are inferred from uploads
  // (computeTemplateId), so their rows below don't resolve via the homepage URL.
  { kind: 'template', value: 'logo-designer', label: 'Logo Designer', description: 'Brand identity and logo showcase.' },
  { kind: 'template', value: 'deep-build', label: 'Deep Build', description: 'Interview → design → plan → build pipeline.' },
  { kind: 'template', value: 'business-plan', label: 'Business Plan', description: 'Guided business-plan website.' },
  { kind: 'template', value: 'zip-import', label: 'ZIP Import', description: 'Write uploaded ZIP contents into the app.' },
  { kind: 'template', value: 'ui-kit-import', label: 'UI Kit Import', description: 'Import a UI kit design system.' },
  { kind: 'template', value: 'file-upload', label: 'File Upload', description: 'Adapt the initial flow to an uploaded file.' },

  // Agents — freeze an exact registered agent (?agent=, advanced).
  { kind: 'agent', value: 'develop', label: 'Develop', description: 'Full-stack development agent.' },
  { kind: 'agent', value: 'marketing', label: 'Marketing', description: 'SEO, marketing, and social.' },
  { kind: 'agent', value: 'deep-build', label: 'Deep Build (orchestrator)', description: 'Deep-build orchestrator agent.' },
  { kind: 'agent', value: 'initial', label: 'Initial (base)', description: 'Base initial agent (v1 prompt).' },
  { kind: 'agent', value: 'initial-v3', label: 'Initial v3', description: 'Modular v3 initial agent.' },
  { kind: 'agent', value: 'initial-prompt-enhancer', label: 'Initial · Prompt Enhancer', description: 'Prompt-enhancer initial variant.' },
  { kind: 'agent', value: 'initial-design-system', label: 'Initial · Design System', description: 'Design-system initial variant.' },
  { kind: 'agent', value: 'initial-design-system-homepage-build', label: 'Initial · Design System (Homepage Build)', description: 'Homepage-build initial variant.' },
  { kind: 'agent', value: 'initial-design-kit', label: 'Initial · Design Kit Wizard', description: 'Design-kit wizard initial variant.' },
]

export const PROFILE_SELECTIONS: readonly StartSelection[] = START_SELECTIONS.filter(s => s.kind === 'profile')
export const TEMPLATE_SELECTIONS: readonly StartSelection[] = START_SELECTIONS.filter(s => s.kind === 'template')
export const AGENT_SELECTIONS: readonly StartSelection[] = START_SELECTIONS.filter(s => s.kind === 'agent')

/** Registered profile names — the allowlist for a client-supplied `?profile=` override. */
export const PROFILE_IDS: readonly string[] = PROFILE_SELECTIONS.map(s => s.value)

/** True when `name` is a known profile in the catalog. */
export function isKnownProfile(name: string): boolean {
  return PROFILE_IDS.includes(name)
}
