import { resolveProfile, runWithProfile, profileValue } from '../profiles/index.js'
import type { ProfileData } from '../profiles/index.js'
import { logger } from '../logging/index.js'
import { profileDefinesCustomModularPromptFiles } from '../agents/modular-prompt-files.js'
import { getRegisteredInitialNamedVariantAgentId } from '../agents/registered-initial-named-variant-ids.js'

/**
 * A `promptVersion` enters the named-variant resolver branch only when it is
 * a non-empty, non-numeric string. Numeric values like `"1.0"` reserve the
 * default initial-agent path; registered numeric variant `"3.0"` is handled
 * by its explicit branch above.
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
  /**
   * Internal-only "start-as" master override (the `?agent=<id>` URL param). Only
   * honored when `startOverrideEnabled` is true (a JWT claim the BFF sets from the
   * `appbuilder-agent-start-override` switchboard flag or employee auth) AND the id
   * is in `getStartableAgentIds()`. Highest priority — above `?template=` and the
   * JWT profile — so internal teams can start any registered agent without touching
   * switchboard/hivemind. A customer setting the param has no effect: their token
   * lacks the claim.
   */
  overrideAgentId?: string
  /** Gate for `overrideAgentId` (JWT `agentStartOverrideEnabled`). */
  startOverrideEnabled?: boolean
  /**
   * Allowlist for `overrideAgentId` — the set of registered/startable agent ids
   * (the factory's `agents.list()`). Sub-agents are excluded because they are never
   * registered there.
   */
  getStartableAgentIds?: () => string[]
  /** `?template=` selection (first-message metadata). Only honored if registered. */
  templateId?: string
  /**
   * The BFF-resolved profile name from the JWT (`agentContext.agentProfile`):
   * switchboard → hivemind. This is the SOLE profile source — there is no
   * per-message client profile.
   */
  jwtAgentProfile?: string
  getModeIds: () => string[]
}

/**
 * Whether an internal "start-as" override is active and names a valid startable
 * agent. Shared by the create-time resolver and the first-message finalize.
 */
export function resolveStartOverrideAgentId(params: {
  overrideAgentId?: string
  startOverrideEnabled?: boolean
  getStartableAgentIds?: () => string[]
}): string | undefined {
  const { overrideAgentId, startOverrideEnabled, getStartableAgentIds } = params
  if (!startOverrideEnabled) return undefined
  if (typeof overrideAgentId !== 'string' || overrideAgentId.length === 0) return undefined
  const startable = getStartableAgentIds?.() ?? []
  return startable.includes(overrideAgentId) ? overrideAgentId : undefined
}

/**
 * Resolve the concrete initial agent id to FREEZE at conversation-create.
 *
 * Priority (top wins):
 *   0. Internal `?agent=<id>` start-as override (gated by `startOverrideEnabled`
 *      + validated against the startable-agent allowlist) — highest priority,
 *      above `?template=` and the profile. Only reachable for internal callers.
 *   1. `?template=` → `initial-<templateId>`
 *   2. JWT switchboard/hivemind profile → base version selector (initial-v3
 *      or named variant). Per-profile initial-v3-<name> variants
 *      were flattened (#4346) — the single initial-v3 reads modularPromptFiles
 *      from the active profile per turn.
 *   3. Default base `initial`
 */
export function resolveInitialAgentId(params: ResolveInitialAgentParams): string {
  const { appId, overrideAgentId, startOverrideEnabled, getStartableAgentIds, templateId, jwtAgentProfile, getModeIds } = params

  // 0. Internal "start-as" override (?agent=<id>), gated by the JWT claim and
  //    validated against the registered agent set. Highest priority — above
  //    ?template= and the JWT profile.
  if (startOverrideEnabled && typeof overrideAgentId === 'string' && overrideAgentId.length > 0) {
    const validOverride = resolveStartOverrideAgentId({ overrideAgentId, startOverrideEnabled, getStartableAgentIds })
    if (validOverride) {
      // ?agent= and ?template= are the same (freeze) axis — the agent override wins.
      // The UI keeps them mutually exclusive; this only fires for hand-crafted URLs.
      if (typeof templateId === 'string' && getModeIds().includes(templateId)) {
        logger.warn('agent_router.start_override_supersedes_template', { appId, overrideAgentId: validOverride, templateId })
      }
      logger.info('agent_router.start_override_applied', { appId, overrideAgentId: validOverride })
      return validOverride
    }
    logger.warn('agent_router.start_override_invalid', { appId, overrideAgentId })
  }

  // 1. ?template= — a distinct registered agent (e.g. initial-v8), not a flag on base initial.
  const validTemplate = typeof templateId === 'string' && getModeIds().includes(templateId)
    ? templateId
    : undefined
  if (validTemplate) {
    return `initial-${validTemplate}`
  }

  // 2. JWT profile (switchboard → hivemind, resolved by the BFF at token mint).
  const jwtProfile = resolveProfile({ jwtAgentProfile })
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
