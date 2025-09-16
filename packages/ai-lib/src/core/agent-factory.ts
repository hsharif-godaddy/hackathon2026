import { Agent } from './agent.js'
import type { AgentConfig, GlobalAgentConfig } from './types.js'

/**
 * Factory for creating and managing agents
 */
export class AgentFactory {
  private agents = new Map<string, Agent>()
  private globalConfig: GlobalAgentConfig

  constructor(globalConfig: GlobalAgentConfig = {}) {
    this.globalConfig = globalConfig
  }

  /**
   * Define multiple agents and return a typed interface for accessing them
   */
  defineAgents<T extends Record<string, AgentConfig>>(agentConfigs: T) {
    const definitions = agentConfigs

    // Create typed getter function
    const get = <K extends keyof T>(id: K): Agent => {
      const stringId = id as string
      
      if (!this.agents.has(stringId)) {
        const config = agentConfigs[id]
        if (!config) {
          throw new Error(`Agent config not found for id: ${stringId}`)
        }
        const mergedConfig = this.mergeWithGlobalConfig(config)
        this.agents.set(stringId, new Agent(mergedConfig))
      }
      
      return this.agents.get(stringId)!
    }

    return {
      /** Get an agent by ID */
      get,
      
      /** Agent definitions (for inspection) */
      definitions,
      
      /** List all agent IDs */
      list: (): (keyof T)[] => Object.keys(agentConfigs),
      
      /** Reload a specific agent (useful for development) */
      reload: (id: keyof T): Agent => {
        this.agents.delete(id as string)
        return get(id)
      },
      
      /** Preload all agents (create instances) */
      preload: (): void => {
        Object.keys(agentConfigs).forEach(id => get(id as keyof T))
      },
      
      /** Check if an agent exists */
      has: (id: keyof T): boolean => {
        return id in agentConfigs
      },
      
      /** Get agent configuration without creating instance */
      getConfig: (id: keyof T): AgentConfig => {
        const config = agentConfigs[id]
        if (!config) {
          throw new Error(`Agent config not found for id: ${String(id)}`)
        }
        return this.mergeWithGlobalConfig(config)
      }
    }
  }

  /**
   * Create a single agent (for dynamic creation)
   */
  createAgent(config: AgentConfig & { id: string }): Agent {
    const mergedConfig = this.mergeWithGlobalConfig(config)
    const agent = new Agent(mergedConfig)
    
    // Cache the agent
    this.agents.set(config.id, agent)
    
    return agent
  }

  /**
   * Update global configuration
   */
  updateGlobalConfig(config: Partial<GlobalAgentConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...config }
    
    // Clear cached agents so they pick up new global config
    this.agents.clear()
  }

  /**
   * Get current global configuration
   */
  getGlobalConfig(): GlobalAgentConfig {
    return { ...this.globalConfig }
  }

  /**
   * Clear all cached agents (useful for development/testing)
   */
  clearCache(): void {
    this.agents.clear()
  }

  /**
   * Get statistics about cached agents
   */
  getStats(): {
    totalDefined: number
    totalCached: number
    cachedAgents: string[]
  } {
    return {
      totalDefined: 0, // This would need to be tracked separately
      totalCached: this.agents.size,
      cachedAgents: Array.from(this.agents.keys())
    }
  }

  /**
   * Merge agent config with global config
   */
  private mergeWithGlobalConfig(config: AgentConfig): AgentConfig {
    const merged: AgentConfig = {
      ...config,
      // Apply global defaults if not specified
      model: config.model || this.globalConfig.defaultModel || 'gpt-4o',
      temperature: config.temperature ?? this.globalConfig.defaultTemperature ?? 0.7,
      maxTokens: config.maxTokens ?? this.globalConfig.defaultMaxTokens ?? 2000,
    }

    // Merge tools (global tools + agent-specific tools)
    if (this.globalConfig.globalTools || config.tools) {
      const globalTools = this.globalConfig.globalTools || []
      const configTools = config.tools || []
      
      // If config.tools is an object, keep it as is
      if (!Array.isArray(configTools)) {
        merged.tools = configTools
      } else {
        // If both are arrays, merge them
        merged.tools = [...globalTools, ...configTools]
      }
    }

    // Merge provider options
    if (this.globalConfig.providerOptions || config.providerOptions) {
      merged.providerOptions = {
        ...this.globalConfig.providerOptions,
        ...config.providerOptions
      }
    }

    return merged
  }
}

/**
 * Create a new agent factory with global configuration
 */
export function createAgentFactory(globalConfig?: GlobalAgentConfig): AgentFactory {
  return new AgentFactory(globalConfig)
}

/**
 * Default agent factory instance (can be used for simple cases)
 */
export const defaultAgentFactory = new AgentFactory()
