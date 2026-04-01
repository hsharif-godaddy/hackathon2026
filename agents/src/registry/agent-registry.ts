import { IAgent, AgentConfig } from '../base/index.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'agent-registry' });

/**
 * Interface for agent constructor
 */
export interface AgentConstructor {
  new (): IAgent;
}

/**
 * Agent registry entry
 */
export interface AgentRegistryEntry {
  /** Agent constructor class */
  constructor: AgentConstructor;
  /** Agent configuration */
  config: AgentConfig;
  /** Singleton instance (created on first access) */
  instance?: IAgent | undefined;
  /** Whether the agent is enabled */
  enabled: boolean;
  /** Registration timestamp */
  registeredAt: Date;
}

/**
 * Registry for managing agent discovery and instantiation
 */
export class AgentRegistry {
  private static _instance: AgentRegistry;
  private _agents = new Map<string, AgentRegistryEntry>();
  private _initialized = false;

  private constructor() {}

  /**
   * Get the singleton instance of the registry
   */
  static getInstance(): AgentRegistry {
    if (!AgentRegistry._instance) {
      AgentRegistry._instance = new AgentRegistry();
    }
    return AgentRegistry._instance;
  }

  /**
   * Register an agent class
   */
  register(agentConstructor: AgentConstructor, enabled = true): void {
    // Create a temporary instance to get the config
    const tempInstance = new agentConstructor();
    const config = tempInstance.getConfig();
    
    if (this._agents.has(config.id)) {
      throw new Error(`Agent with id '${config.id}' is already registered`);
    }

    this._agents.set(config.id, {
      constructor: agentConstructor,
      config,
      enabled,
      registeredAt: new Date(),
    });

    logger.info('agent-registry.register', {
      agentName: config.name,
      agentId: config.id,
    });
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): boolean {
    const entry = this._agents.get(agentId);
    if (!entry) {
      return false;
    }

    // Cleanup instance if it exists
    if (entry.instance) {
      const cleanup = entry.instance.cleanup();
      if (cleanup instanceof Promise) {
        cleanup.catch((error: unknown) => {
          logger.error('agent-registry.unregister.cleanup-error', {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    return this._agents.delete(agentId);
  }

  /**
   * Get an agent instance (creates if doesn't exist)
   */
  async getAgent(agentId: string): Promise<IAgent> {
    const entry = this._agents.get(agentId);
    if (!entry) {
      throw new Error(`Agent '${agentId}' not found in registry`);
    }

    if (!entry.enabled) {
      throw new Error(`Agent '${agentId}' is disabled`);
    }

    // Create instance if it doesn't exist
    if (!entry.instance) {
      entry.instance = new entry.constructor();
      await entry.instance.initialize();
    }

    return entry.instance;
  }

  /**
   * Check if an agent is registered
   */
  hasAgent(agentId: string): boolean {
    return this._agents.has(agentId);
  }

  /**
   * Get agent configuration without creating an instance
   */
  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this._agents.get(agentId)?.config;
  }

  /**
   * Get all registered agent IDs
   */
  getAgentIds(): string[] {
    return Array.from(this._agents.keys());
  }

  /**
   * Get all enabled agent IDs
   */
  getEnabledAgentIds(): string[] {
    return Array.from(this._agents.entries())
      .filter(([, entry]) => entry.enabled)
      .map(([id]) => id);
  }

  /**
   * Get all agent configurations
   */
  getAllConfigs(): AgentConfig[] {
    return Array.from(this._agents.values()).map(entry => entry.config);
  }

  /**
   * Get enabled agent configurations
   */
  getEnabledConfigs(): AgentConfig[] {
    return Array.from(this._agents.values())
      .filter(entry => entry.enabled)
      .map(entry => entry.config);
  }

  /**
   * Enable/disable an agent
   */
  setAgentEnabled(agentId: string, enabled: boolean): boolean {
    const entry = this._agents.get(agentId);
    if (!entry) {
      return false;
    }

    entry.enabled = enabled;
    
    // If disabling and instance exists, cleanup
    if (!enabled && entry.instance) {
      const cleanup = entry.instance.cleanup();
      if (cleanup instanceof Promise) {
        cleanup.catch((error: unknown) => {
          logger.error('agent-registry.disable.cleanup-error', {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      entry.instance = undefined;
    }

    return true;
  }

  /**
   * Search agents by tags
   */
  findAgentsByTag(tag: string): AgentConfig[] {
    return Array.from(this._agents.values())
      .filter(entry => entry.enabled && entry.config.tags?.includes(tag))
      .map(entry => entry.config);
  }

  /**
   * Search agents by name or description (case-insensitive)
   */
  searchAgents(query: string): AgentConfig[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this._agents.values())
      .filter(entry => 
        entry.enabled && (
          entry.config.name.toLowerCase().includes(lowerQuery) ||
          entry.config.description.toLowerCase().includes(lowerQuery)
        )
      )
      .map(entry => entry.config);
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const total = this._agents.size;
    const enabled = Array.from(this._agents.values()).filter(e => e.enabled).length;
    const withInstances = Array.from(this._agents.values()).filter(e => e.instance).length;

    return {
      total,
      enabled,
      disabled: total - enabled,
      instantiated: withInstances,
      initialized: this._initialized,
    };
  }

  /**
   * Initialize all registered agents
   */
  async initializeAll(): Promise<void> {
    if (this._initialized) {
      return;
    }

    logger.info('agent-registry.initialize.begin', {
      agentCount: this._agents.size,
    });
    
    const initPromises: Promise<void>[] = [];
    
    for (const [agentId, entry] of this._agents.entries()) {
      if (entry.enabled) {
        initPromises.push(
          this.getAgent(agentId).then(() => {
            // Successfully initialized
          }).catch(error => {
            logger.error('agent-registry.initialize.agent-error', {
              agentId,
              error: error instanceof Error ? error.message : String(error),
            });
          })
        );
      }
    }

    await Promise.allSettled(initPromises);
    this._initialized = true;
    logger.info('agent-registry.initialize.complete', {});
  }

  /**
   * Cleanup all agent instances
   */
  async cleanup(): Promise<void> {
    logger.info('agent-registry.cleanup.begin', {});
    
    const cleanupPromises: Promise<void>[] = [];
    
    for (const entry of this._agents.values()) {
      if (entry.instance) {
        const cleanup = entry.instance.cleanup();
        if (cleanup instanceof Promise) {
          cleanupPromises.push(
            cleanup.catch((error: unknown) => {
              logger.error('agent-registry.cleanup.agent-error', {
                error: error instanceof Error ? error.message : String(error),
              });
            })
          );
        }
        entry.instance = undefined;
      }
    }

    await Promise.allSettled(cleanupPromises);
    this._initialized = false;
    logger.info('agent-registry.cleanup.complete', {});
  }

  /**
   * Validate all registered agents
   */
  async validateAll(): Promise<{ valid: string[]; invalid: { id: string; error: string }[] }> {
    const valid: string[] = [];
    const invalid: { id: string; error: string }[] = [];

    for (const [agentId, entry] of this._agents.entries()) {
      try {
        const tempInstance = new entry.constructor();
        await tempInstance.validate();
        valid.push(agentId);
      } catch (error) {
        invalid.push({
          id: agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { valid, invalid };
  }
}
