import type { SubAgentConfig } from '../sub-agent-runner.js'
import { createDiscoveryConfig } from './discovery.js'

type SubAgentName = 'discovery'

const configFactories: Record<SubAgentName, (appPath: string) => Promise<SubAgentConfig>> = {
  discovery: createDiscoveryConfig,
}

export async function getSubAgentConfig(name: SubAgentName, appPath: string): Promise<SubAgentConfig> {
  const factory = configFactories[name]
  if (!factory) {
    throw new Error(`Invalid sub-agent name: "${name}". Valid: ${Object.keys(configFactories).join(', ')}`)
  }
  return factory(appPath)
}

export type { SubAgentName }
