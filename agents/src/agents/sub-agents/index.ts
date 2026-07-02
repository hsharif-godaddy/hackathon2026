import type { SubAgentConfig } from '../sub-agent-runner.js'
import { createDiscoveryConfig } from './discovery.js'
import { createPlanningConfig } from './planning.js'
import { createPlanReviewConfig } from './plan-review.js'
import { createMediaConfig } from './media.js'
import { createDesignConfig } from './design.js'
import { createBuilderConfig } from './builder.js'
import { createDesignKitBuildConfig } from './design-kit-build.js'
import { createTaskWorkerConfig } from './task-worker.js'
import { createBrandShowcaseConfig } from './brand-showcase.js'
import { createVerificationConfig } from './verification.js'
import { createWorkflowInitConfig } from './workflow-init.js'
import { createDeveloperTypecheckConfig } from './developer-typecheck.js'

type SubAgentName = 'discovery' | 'planning' | 'plan-review' | 'media' | 'design' | 'builder' | 'design-kit-build' | 'task-worker' | 'brand-showcase' | 'verification' | 'workflow-init' | 'developer-typecheck'

const configFactories: Record<SubAgentName, () => Promise<SubAgentConfig>> = {
  discovery: createDiscoveryConfig,
  planning: createPlanningConfig,
  'plan-review': createPlanReviewConfig,
  media: createMediaConfig,
  design: createDesignConfig,
  builder: createBuilderConfig,
  'design-kit-build': createDesignKitBuildConfig,
  'task-worker': createTaskWorkerConfig,
  'brand-showcase': createBrandShowcaseConfig,
  verification: createVerificationConfig,
  'workflow-init': createWorkflowInitConfig,
  'developer-typecheck': createDeveloperTypecheckConfig,
}

export async function getSubAgentConfig(name: SubAgentName): Promise<SubAgentConfig> {
  const factory = configFactories[name]
  if (!factory) {
    throw new Error(`Invalid sub-agent name: "${name}". Valid: ${Object.keys(configFactories).join(', ')}`)
  }
  return factory()
}

export type { SubAgentName }
