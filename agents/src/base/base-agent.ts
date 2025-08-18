import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  IAgent,
  AgentConfig,
  AgentToolConfig,
  AgentContextConfig,
  AgentHandoffConfig,
  AgentExecutionContext,
} from './agent.interface.js';

/**
 * Abstract base class that provides common functionality for all agents
 */
export abstract class BaseAgent implements IAgent {
  protected _config: AgentConfig;
  protected _systemPrompt?: string;
  protected _isInitialized = false;

  constructor(config: AgentConfig) {
    this._config = config;
  }

  /**
   * Get the agent's configuration
   */
  getConfig(): AgentConfig {
    return this._config;
  }

  /**
   * Get the system prompt for this agent
   * Default implementation loads from a markdown file in the prompts directory
   */
  async getSystemPrompt(context?: AgentExecutionContext): Promise<string> {
    if (!this._systemPrompt) {
      this._systemPrompt = await this.loadSystemPromptFromFile();
    }
    
    // Allow subclasses to customize the prompt based on context
    return this.customizeSystemPrompt(this._systemPrompt, context);
  }

  /**
   * Load system prompt from markdown file
   * Looks for {agent-id}.md in the prompts directory
   */
  protected async loadSystemPromptFromFile(): Promise<string> {
    try {
      // Get the current file's directory and navigate to prompts
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const promptsDir = path.resolve(currentDir, '..', 'prompts');
      const promptFile = path.join(promptsDir, `${this._config.id}.md`);
      
      const content = await fs.readFile(promptFile, 'utf-8');
      return content.trim();
    } catch (error) {
      throw new Error(
        `Failed to load system prompt for agent '${this._config.id}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Override this method to customize the system prompt based on execution context
   */
  protected customizeSystemPrompt(
    basePrompt: string,
    context?: AgentExecutionContext
  ): string {
    // Default implementation returns the base prompt unchanged
    // Subclasses can override to inject dynamic content
    return basePrompt;
  }

  /**
   * Get the list of tools this agent can use
   */
  getTools(): AgentToolConfig[] {
    return this._config.tools;
  }

  /**
   * Get context builder configuration
   */
  getContextBuilder(): AgentContextConfig | undefined {
    return this._config.contextBuilder;
  }

  /**
   * Get handoff configuration
   */
  getHandoffs(): AgentHandoffConfig[] {
    return this._config.handoffs || [];
  }

  /**
   * Validate that the agent is properly configured
   */
  async validate(): Promise<void> {
    // Basic validation
    if (!this._config.id) {
      throw new Error('Agent must have an id');
    }
    
    if (!this._config.name) {
      throw new Error('Agent must have a name');
    }
    
    if (!this._config.tools || this._config.tools.length === 0) {
      throw new Error('Agent must have at least one tool');
    }
    
    // Validate that system prompt can be loaded
    try {
      await this.getSystemPrompt();
    } catch (error) {
      throw new Error(
        `System prompt validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    
    // Allow subclasses to add custom validation
    await this.customValidation();
  }

  /**
   * Override this method to add custom validation logic
   */
  protected async customValidation(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }
    
    await this.validate();
    await this.customInitialization();
    this._isInitialized = true;
  }

  /**
   * Override this method to add custom initialization logic
   */
  protected async customInitialization(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Cleanup resources when the agent is being destroyed
   */
  async cleanup(): Promise<void> {
    await this.customCleanup();
    this._isInitialized = false;
  }

  /**
   * Override this method to add custom cleanup logic
   */
  protected async customCleanup(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Check if the agent is initialized
   */
  isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get agent metadata for display/discovery purposes
   */
  getMetadata() {
    return {
      id: this._config.id,
      name: this._config.name,
      description: this._config.description,
      version: this._config.version,
      tags: this._config.tags,
      toolCount: this._config.tools.length,
      hasContextBuilder: !!this._config.contextBuilder,
      handoffCount: this._config.handoffs?.length || 0,
    };
  }

  /**
   * Create a string representation of the agent for logging
   */
  toString(): string {
    return `${this.constructor.name}(${this._config.id})`;
  }
}
