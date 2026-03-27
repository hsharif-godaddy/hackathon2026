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
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'base-agent' });

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
    // Always reload the prompt to ensure we get the latest template composition
    // based on the current context (app metadata, etc.)
    this._systemPrompt = await this.loadSystemPromptFromFile(context);
    
    // Allow subclasses to customize the prompt based on context
    return this.customizeSystemPrompt(this._systemPrompt, context);
  }

  /**
   * Load system prompt from markdown file
   * Looks for {agent-id}.md in the prompts directory
   * Supports composition with template descriptions
   */
  protected async loadSystemPromptFromFile(context?: AgentExecutionContext): Promise<string> {
    try {
      // Get the current file's directory and navigate to prompts
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const promptsDir = path.resolve(currentDir, '..', 'prompts');
      const promptFile = path.join(promptsDir, `${this._config.id}.md`);
      
      let baseContent = await fs.readFile(promptFile, 'utf-8');
      
      // Always try to compose with templates (simplified logic)
      baseContent = await this.composePrompt(baseContent, promptsDir, context);
      
      return baseContent.trim();
    } catch (error) {
      throw new Error(
        `Failed to load system prompt for agent '${this._config.id}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Compose the base prompt with template descriptions and fragments
   */
  protected async composePrompt(baseContent: string, promptsDir: string, context?: AgentExecutionContext): Promise<string> {
    let composedContent = baseContent;

    // Determine template to include based on app metadata or configuration
    const templateName = this.getTemplateForComposition(context);
    
    if (templateName) {
      const templateDescriptionsDir = path.join(promptsDir, 'template-descriptions');
      const templateFile = path.join(templateDescriptionsDir, `${templateName}.md`);
      
      try {
        const templateContent = await fs.readFile(templateFile, 'utf-8');
        
        // Look for template insertion point or append at the end
        const insertionPoint = composedContent.indexOf('{{TEMPLATE_DESCRIPTION}}');
        if (insertionPoint !== -1) {
          composedContent = composedContent.replace('{{TEMPLATE_DESCRIPTION}}', templateContent.trim());
        } else {
          // If no specific insertion point, insert after the header but before main content
          const headerEnd = composedContent.indexOf('\n\n');
          if (headerEnd !== -1) {
            composedContent = composedContent.slice(0, headerEnd + 2) + 
                             templateContent.trim() + '\n\n' + 
                             composedContent.slice(headerEnd + 2);
          } else {
            composedContent += '\n\n' + templateContent.trim();
          }
        }
        
        logger.info('base-agent.template.loaded', { templateName })
      } catch (error) {
        logger.warn('base-agent.template.load-failed', {
          templateName,
          error: error instanceof Error ? error.message : String(error),
        })
        
        // Fallback to default template if specific template fails
        if (templateName !== 'default') {
          try {
            const defaultTemplateFile = path.join(templateDescriptionsDir, 'default.md');
            const defaultContent = await fs.readFile(defaultTemplateFile, 'utf-8');
            const insertionPoint = composedContent.indexOf('{{TEMPLATE_DESCRIPTION}}');
            if (insertionPoint !== -1) {
              composedContent = composedContent.replace('{{TEMPLATE_DESCRIPTION}}', defaultContent.trim());
            }
            logger.info('base-agent.template.fallback-to-default', {})
          } catch (defaultError) {
            logger.warn('base-agent.template.default-load-failed', {
              error: defaultError instanceof Error ? defaultError.message : String(defaultError),
            })
          }
        }
      }
    }

    // Load and insert additional fragments from configuration
    const composition = this._config.promptComposition;
    if (composition?.fragments && composition.fragments.length > 0) {
      for (const fragmentName of composition.fragments) {
        try {
          const fragmentFile = path.join(promptsDir, 'fragments', `${fragmentName}.md`);
          const fragmentContent = await fs.readFile(fragmentFile, 'utf-8');
          composedContent += '\n\n' + fragmentContent.trim();
        } catch (error) {
          logger.warn('base-agent.fragment.load-failed', {
            fragmentName,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    return composedContent;
  }

  /**
   * Get the template name for composition based on app metadata or configuration
   */
  protected getTemplateForComposition(context?: AgentExecutionContext): string {
    // First, check if templates are explicitly configured
    const composition = this._config.promptComposition;
    if (composition?.templates && composition.templates.length > 0 && composition.templates[0]) {
      logger.info('base-agent.template-version.explicit', {
        template: composition.templates[0],
      })
      return composition.templates[0];
    }
    
    // Next, check if we have app metadata with template version
    const appTemplateVersion = context?.metadata?.templateVersion as string;
    if (appTemplateVersion) {
      logger.info('base-agent.template-version.from-app', { appTemplateVersion })
      return appTemplateVersion;
    }
    
    // Fallback to v8 (only supported template version)
    const templateVersion = 'v8';
    logger.info('base-agent.template-version.env-fallback', { templateVersion })
    return templateVersion;
  }

  /**
   * Override this method to customize the system prompt based on execution context
   */
  protected customizeSystemPrompt(
    basePrompt: string,
    _context?: AgentExecutionContext
  ): string {
    // Default implementation returns the base prompt unchanged
    // Subclasses can override to inject dynamic content
    return basePrompt;
  }

  /**
   * Generate visual context awareness section for agents
   * This provides common visual context handling that all agents can use
   */
  protected generateVisualContextSection(
    context?: AgentExecutionContext, 
    customGuidance?: string
  ): string {
    if (!context?.metadata?.visualContext) {
      return '';
    }

    const visualContext = context.metadata.visualContext as any;
    
    let contextSection = `\n\n## Visual Context Awareness
The user is currently viewing their application at:
- Page: ${visualContext.page || 'unknown'}
- Active Section: ${visualContext.active_section || 'unknown'}
- Scroll Position: ${visualContext.scroll_position?.y || 0}px from top
- Viewport: ${visualContext.viewport?.width || 0}x${visualContext.viewport?.height || 0}

When the user uses ambiguous references like "this", "here", "that", or "these", they are likely referring to:
1. Elements visible in the "${visualContext.active_section}" section
2. Content around the ${visualContext.scroll_position?.y || 0}px scroll position
3. UI components currently in their viewport`;

    // Add custom guidance if provided
    if (customGuidance) {
      contextSection += `\n\n${customGuidance}`;
    }

    return contextSection;
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
