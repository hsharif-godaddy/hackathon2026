import { resolveProfile, runWithProfile, profileValue } from '../profiles/index.js'
import type { ProfileData } from '../profiles/index.js'
import { logger } from '../logging/index.js'
import { profileDefinesCustomModularPromptFiles } from '../agents/modular-prompt-files.js'
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
 *   2. JWT switchboard/hivemind profile → base version selector (initial-v3,
 *      initial-v2, or named variant). Per-profile initial-v3-<name> variants
 *      were flattened (#4346) — the single initial-v3 reads modularPromptFiles
 *      from the active profile per turn.
 *   3. Default base `initial`
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
 * Map a resolved profile to its concrete initial-agent id. Per-profile
 * initial-v3-<name> variants were flattened (#4346): modularPromptFiles now
 * resolves to base initial-v3 which reads the files per turn. Named variants
 * (non-numeric promptVersion) are still supported for distinct agent configs.
 */
function concreteInitialForProfile(profile: ProfileData, appId: string): string {
  if (profileDefinesCustomModularPromptFiles(profile)) {
    return 'initial-v3'
  }

  const promptVersion = runWithProfile(profile, () => profileValue('initial.promptVersion', '' as string)).trim()
  if (promptVersion === '2.0') {
    return 'initial-v2'
  }
  if (promptVersion === '3.0') {
    return 'initial-v3'
  }
  if (isNamedVariantVersion(promptVersion)) {
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
