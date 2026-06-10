import type { SubAgentConfig } from '../sub-agent-runner.js'
import { createDiscoveryConfig } from './discovery.js'
import { createPlanningConfig } from './planning.js'
import { createPlanReviewConfig } from './plan-review.js'
import { createMediaConfig } from './media.js'
import { createDesignConfig } from './design.js'
import { createBuilderConfig } from './builder.js'
import { createVerificationConfig } from './verification.js'

type SubAgentName = 'discovery' | 'planning' | 'plan-review' | 'media' | 'design' | 'builder' | 'verification'

const configFactories: Record<SubAgentName, (appPath: string) => Promise<SubAgentConfig>> = {
  discovery: createDiscoveryConfig,
  planning: createPlanningConfig,
  'plan-review': createPlanReviewConfig,
  media: createMediaConfig,
  design: createDesignConfig,
  builder: createBuilderConfig,
  verification: createVerificationConfig,
}

export async function getSubAgentConfig(name: SubAgentName, appPath: string): Promise<SubAgentConfig> {
  const factory = configFactories[name]
  if (!factory) {
    throw new Error(`Invalid sub-agent name: "${name}". Valid: ${Object.keys(configFactories).join(', ')}`)
  }
  return factory(appPath)
}

export type { SubAgentName }
