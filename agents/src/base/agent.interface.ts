import { AgentOutputType } from '@openai/agents';

/**
 * Configuration interface for agent tools
 */
export interface AgentToolConfig {
  /** Name of the tool */
  name: string;
  /** Optional description of what the tool does */
  description?: string;
  /** Whether this tool is required for the agent to function */
  required?: boolean;
}

/**
 * Configuration interface for agent context builders
 */
export interface AgentContextConfig {
  /** List of tools to call for building context */
  tools: string[];
  /** Whether to skip context building for faster initialization */
  skipContextBuilding?: boolean;
}

/**
 * Configuration interface for agent handoffs
 */
export interface AgentHandoffConfig {
  /** Name/identifier of the agent to handoff to */
  agentName: string;
  /** Description of when this handoff should be used */
  description?: string;
}

/**
 * Configuration interface for prompt composition
 */
export interface PromptCompositionConfig {
  /** Template descriptions to include (from template-descriptions directory) */
  templates?: string[];
  /** Additional prompt fragments to compose */
  fragments?: string[];
}

/**
 * Base configuration interface that all agents must implement
 */
export interface AgentConfig {
  /** Unique identifier for the agent */
  readonly id: string;
  
  /** Human-readable name of the agent */
  readonly name: string;
  
  /** Brief description of what the agent does */
  readonly description: string;
  
  /** OpenAI model to use (defaults to gpt-4) */
  readonly model?: string;
  
  /** Output type for the agent */
  readonly outputType?: AgentOutputType;
  
  /** List of tools this agent can use */
  readonly tools: AgentToolConfig[];
  
  /** Context building configuration */
  readonly contextBuilder?: AgentContextConfig;
  
  /** List of agents this agent can handoff to */
  readonly handoffs?: AgentHandoffConfig[];
  
  /** Version of the agent implementation */
  readonly version?: string;
  
  /** Tags for categorizing/filtering agents */
  readonly tags?: string[];
  
  /** Prompt composition configuration */
  readonly promptComposition?: PromptCompositionConfig;
}

/**
 * Runtime context passed to agents during execution
 */
export interface AgentExecutionContext {
  /** Unique thread/session identifier */
  threadId: string;
  
  /** User identifier (if available) */
  userId?: string | undefined;
  
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined;
  
  /** Request timestamp */
  timestamp: Date;
}

/**
 * Main interface that all agents must implement
 */
export interface IAgent {
  /**
   * Get the agent's configuration
   */
  getConfig(): AgentConfig;
  
  /**
   * Get the system prompt for this agent
   * This can be dynamic based on the execution context
   */
  getSystemPrompt(context?: AgentExecutionContext): Promise<string> | string;
  
  /**
   * Get the list of tools this agent can use
   */
  getTools(): AgentToolConfig[];
  
  /**
   * Get context builder configuration
   */
  getContextBuilder(): AgentContextConfig | undefined;
  
  /**
   * Get handoff configuration
   */
  getHandoffs(): AgentHandoffConfig[];
  
  /**
   * Validate that the agent is properly configured
   * Should throw an error if the configuration is invalid
   */
  validate(): Promise<void> | void;
  
  /**
   * Initialize the agent (called once during startup)
   * Use this for any setup that needs to happen before the agent can be used
   */
  initialize(): Promise<void> | void;
  
  /**
   * Cleanup resources when the agent is being destroyed
   */
  cleanup(): Promise<void> | void;
  
  /**
   * Optional: Custom processing before tool execution
   * Can be used to modify or validate tool calls
   */
  beforeToolExecution?(toolName: string, args: unknown): Promise<unknown> | unknown;
  
  /**
   * Optional: Custom processing after tool execution
   * Can be used to transform or validate tool results
   */
  afterToolExecution?(toolName: string, args: unknown, result: unknown): Promise<unknown> | unknown;
}
