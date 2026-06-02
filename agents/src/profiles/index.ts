import { logger } from '../logging/index.js'
import type { ProfileData } from './types.js'
import { ProfileSchema } from './types.js'

export { type ProfileData } from './types.js'
export { runWithProfile, getActiveProfile } from './profile-context.js'
export { profileValue, profileFlag, hasActiveProfile, activeProfileName } from './profile-accessor.js'

// Static imports so JSON is bundled into the build output (tsc does not copy
// standalone JSON files to dist/, so readdirSync at runtime would find nothing).
// When adding a new profile, import it here and add it to the rawProfiles array.
import experimentalProfile from './experimental.json' with { type: 'json' }
import newInitialAgentProfile from './new-initial-agent.json' with { type: 'json' }
import initialAgentV1Profile from './initial-agent-v1.json' with { type: 'json' }
import initialAgentV3Profile from './initial-agent-v3.json' with { type: 'json' }
import promptEnhancerProfile from './prompt-enhancer.json' with { type: 'json' }
import initialAgentDesignSystemProfile from './initial-agent-design-system.json' with { type: 'json' }
import initialAgentDesignSystemHomepageBuildProfile from './initial-agent-design-system-homepage-build.json' with { type: 'json' }

const rawProfiles: unknown[] = [
  experimentalProfile,
  newInitialAgentProfile,
  initialAgentV1Profile,
  initialAgentV3Profile,
  promptEnhancerProfile,
  initialAgentDesignSystemProfile,
  initialAgentDesignSystemHomepageBuildProfile,
]

let registry: Map<string, ProfileData> | null = null

function loadProfiles(): Map<string, ProfileData> {
  const profiles = new Map<string, ProfileData>()

  for (const raw of rawProfiles) {
    const result = ProfileSchema.safeParse(raw)
    if (!result.success) {
      logger.warn('profile.load.invalid', {
        errors: result.error.issues.map(i => i.message),
      })
      continue
    }

    const profile = result.data
    if (profiles.has(profile.name)) {
      logger.error('profile.load.duplicate', {
        profileName: profile.name,
        message: 'Duplicate profile name, skipping',
      })
      continue
    }

    profiles.set(profile.name, profile)
    logger.info('profile.load.success', {
      profileName: profile.name,
      propertyCount: Object.keys(profile.properties).length,
    })
  }

  return profiles
}

export function getProfileRegistry(): Map<string, ProfileData> {
  if (!registry) {
    registry = loadProfiles()
  }
  return registry
}

export function resolveProfile(params: {
  agentProfileSelectorEnabled: boolean
  perProjectProfile?: string
  jwtAgentProfile?: string
}): ProfileData | null {
  const perProject = params.agentProfileSelectorEnabled ? params.perProjectProfile : undefined
  const profileName = perProject || params.jwtAgentProfile || undefined

  if (!profileName || profileName === 'default') {
    logger.debug('profile.resolve.none', { reason: profileName ? 'default' : 'no profile specified' })
    return null
  }

  const reg = getProfileRegistry()
  const profile = reg.get(profileName)
  if (!profile) {
    logger.warn('profile.resolve.unknown', { profileName })
    return null
  }

  return profile
}
