import { resolveProfile, runWithProfile, profileValue } from '../profiles/index.js'
import type { ProfileData } from '../profiles/index.js'
import { logger } from '../logging/index.js'
import { profileDefinesCustomModularPromptFiles } from '../agents/modular-prompt-files.js'
import { getRegisteredInitialV3ModularAgentIds } from '../agents/registered-initial-modular-agent-ids.js'
import { getRegisteredInitialNamedVariantAgentId } from '../agents/registered-initial-named-variant-ids.js'

/**
 * A `promptVersion` enters the named-variant resolver branch only when it is
 * a non-empty, non-numeric string. Numeric values like `"1.0"` reserve the
 * default initial-agent path; registered numeric variants (`"2.0"`, `"3.0"`)
 * are handled by their explicit branches above.
 */
export function isNamedVariantVersion(promptVersion: string | null | undefined): promptVersion is string {
  if (promptVersion == null) return false
  const trimmed = promptVersion.trim()
  if (trimmed.length === 0) return false
  // A purely-numeric dotted version ("1.0", "2.0", "3.0", "4.0") is reserved for
  // the default/initial path; anything else (e.g. "design-system") is a named
  // variant. Split-and-check each segment rather than a nested-quantifier regex
  // (`^\d+(\.\d+)*$`) so there is no ReDoS backtracking surface.
  const isNumericVersion = trimmed.split('.').every(segment => segment.length > 0 && /^[0-9]+$/.test(segment))
  return !isNumericVersion
}

export interface ResolveInitialAgentParams {
  appId: string
  /** `?template=` selection (first-message metadata). Only honored if registered. */
  templateId?: string
  /**
   * The BFF-resolved profile name from the JWT (`agentContext.agentProfile`):
   * switchboard → hivemind. This is the SOLE profile source — there is no
   * per-message client profile.
   */
  jwtAgentProfile?: string
  getTemplateIds: () => string[]
}

/**
 * Resolve the concrete initial agent id to FREEZE at conversation-create.
 *
 * Priority (top wins; `/agent <name>` is handled upstream and bypasses this):
 *   1. `?template=` → `initial-<templateId>`
 *   2. JWT switchboard/hivemind profile (the normal-user / experiment path; the
 *      sole profile source)
 *   3. Default base `initial`
 *
 * A *registered* profile wins even if it maps to base `initial`. The result is
 * always a concrete id and is stored verbatim — never re-derived per message.
 */
export function resolveInitialAgentId(params: ResolveInitialAgentParams): string {
  const { appId, templateId, jwtAgentProfile, getTemplateIds } = params

  // 1. ?template= — a distinct registered agent (e.g. initial-v8), not a flag on base initial.
  const validTemplate = typeof templateId === 'string' && getTemplateIds().includes(templateId)
    ? templateId
    : undefined
  if (validTemplate) {
    return `initial-${validTemplate}`
  }

  // 2. JWT profile (switchboard → hivemind, resolved by the BFF at token mint).
  const jwtProfile = resolveProfile({
    agentProfileSelectorEnabled: false,
    perProjectProfile: undefined,
    jwtAgentProfile,
  })
  if (jwtProfile) {
    return concreteInitialForProfile(jwtProfile, appId)
  }

  // 3. Default base agent.
  return 'initial'
}

/**
 * Map a resolved profile to its concrete initial-agent id. Returns base
 * `initial` when the profile defines no initial variant (or its variant failed
 * to register at startup). Mirrors the registration logic in the agent factory.
 */
function concreteInitialForProfile(profile: ProfileData, appId: string): string {
  if (profileDefinesCustomModularPromptFiles(profile)) {
    const variantId = `initial-v3-${profile.name}`
    if (getRegisteredInitialV3ModularAgentIds().has(variantId)) {
      return variantId
    }
    // A profile that declares modular prompt files but whose initial-v3-<name>
    // never registered is a deploy-time wiring defect (the variant should have
    // been built at startup) — alertable, unlike the benign numeric fall-through
    // below. Fall back to the shared initial-v3 so the turn still proceeds.
    logger.error('agent_router.initial_modular_variant_unregistered', {
      appId,
      profileName: profile.name,
      variantId,
      fallbackAgentId: 'initial-v3',
    })
    return 'initial-v3'
  }

  // Trim once so the numeric checks and the named-variant registry lookup all use
  // the same canonical value (a padded ' prompt-enhancer ' must not pass the
  // named-variant check yet miss the registry key).
  const promptVersion = runWithProfile(profile, () => profileValue('initial.promptVersion', '' as string)).trim()
  if (promptVersion === '2.0') {
    return 'initial-v2'
  }
  if (promptVersion === '3.0') {
    return 'initial-v3'
  }
  if (isNamedVariantVersion(promptVersion)) {
    // Only non-numeric, non-empty strings enter the named-variant branch.
    // Numeric versions like `1.0` (current) or `4.0` (hypothetical) fall
    // through to base initial and must not emit the unregistered warn.
    const namedVariantAgentId = getRegisteredInitialNamedVariantAgentId(promptVersion)
    if (namedVariantAgentId) {
      return namedVariantAgentId
    }
    logger.warn('agent_router.initial_named_variant_unregistered', {
      appId,
      profileName: profile.name,
      promptVersion,
    })
  }

  return 'initial'
}
