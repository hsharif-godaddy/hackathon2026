import {
  createAgentFactory,
  type AgentConfig,
  type AfterToolExecutionHook,
  type AgentContext,
  createPromptBuilder
} from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { logger, log } from '../logging/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { getPersistentAssetPaths } from '../utils/persistent-assets.js'
import { readFile } from 'fs/promises'

/**
 * Design Agent - Creates concise design documentation for applications
 * Generates 8 design sections stored in memory: Brand Personality, Color Palette,
 * Typography, Iconography, Layout, Voice & Messaging, Features, Site Map
 */

/**
 * Track design section updates for logging
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown,
  toolCallError: unknown,
  context?: AgentContext
): Promise<unknown> => {
  const appId = context?.metadata?.appId as string
  const contextLogger = appId ? log.withContext({ appId, agentId: 'design' }) : logger

  contextLogger.info('design_agent.tool.execution.complete', {
    toolName
  });

  const resultObj = result as any;

  // Track design section updates
  if (toolName === 'memorySet' && resultObj?.success) {
    const setArgs = args as { key: string };
    if (setArgs.key.startsWith('design.')) {
      contextLogger.info('design_agent.section.updated', {
        section: setArgs.key,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Track design searches
  if (toolName === 'memorySearch' && resultObj?.success) {
    contextLogger.info('design_agent.inspiration.search', {
      resultsCount: resultObj.results?.length || 0
    });
  }

  return result;
}

/**
 * Build the system prompt for the Design Agent
 */
async function buildDesignSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder();

  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url);

  // Load filesystem.md as a template (contains {{persistentPublicPath}} and {{persistentPrivatePath}} placeholders)
  const filesystemTemplate = await readFile(paths.getSharedFile('filesystem.md'), 'utf-8');

  // Load all modular prompt sections in order
  // Order: Identity → Voice → Technical details
  promptBuilder
    .file(paths.getAgentFile('design', 'core.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getAgentFile('design', 'sections.md'))
    .file(paths.getAgentFile('design', 'memory-usage.md'))
    .file(paths.getAgentFile('design', 'workflow.md'))
    .template(filesystemTemplate) // Use template instead of file for dynamic path interpolation
    .file(paths.getSharedFile('security.md'));

  // Build with context containing dynamic persistent asset paths
  const persistentAssetPaths = getPersistentAssetPaths();
  return await promptBuilder.build(persistentAssetPaths);
}

/**
 * Create the Design Agent configuration
 */
export async function createDesignAgent(): Promise<AgentConfig> {
  const systemPrompt = await buildDesignSystemPrompt();
  const { model, modelName } = await getAgentModelWithName('full'); // Use full model for comprehensive design work

  return {
    id: 'design',
    name: 'Design System Creator',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      // Memory operations for storing/retrieving design sections
      memorySet: allAILibTools.memorySet,
      memoryRead: allAILibTools.memoryRead,
      memorySearch: allAILibTools.memorySearch,
      memoryListKeys: allAILibTools.memoryListKeys,

      // File operations for reading existing design files
      readFile: allAILibTools.readFile,
      directoryListing: allAILibTools.directoryListing,
    },

    // Tool execution hooks
    afterToolExecution,

    // Handoff configuration
    handoffs: [
      {
        agentName: 'develop',
        description: 'Hand off to development agent to implement design system in code',
      },
    ],

    maxSteps: 20,
    temperature: 0.7, // Higher temperature for creative design work
    maxOutputTokens: 4000,
    timeout: { stepMs: 300_000 },
    providerOptions: {
      anthropic: {
        effort: 'low',
      },
    },
    logger: createAgentTelemetryLogger('design')
  };
}

/**
 * Create Design Agent factory
 */
export async function createDesignAgentFactory() {
  const factory = createAgentFactory();

  const agents = factory.defineAgents({
    design: await createDesignAgent()
  });

  return {
    factory,
    agents,
    getAgent: () => agents.get('design')
  };
}

/**
 * Design Agent class wrapper for backward compatibility
 */
export class DesignAgent {
  private factory: Awaited<ReturnType<typeof createDesignAgentFactory>>

  constructor() {
    this.factory = null as any;
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    logger.info('design_agent.initialization.start');
    this.factory = await createDesignAgentFactory();
    logger.info('design_agent.initialization.complete');
  }

  /**
   * Get the agent instance
   */
  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }
    return this.factory.getAgent();
  }

  /**
   * Get agent factory for advanced usage
   */
  getFactory() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }
    return this.factory.factory;
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }
    return this.factory.agents.getConfig('design');
  }

  /**
   * Stream generate response
   */
  async streamGenerate(prompt: string, options?: any) {
    const agent = this.getAgent();
    return agent.streamGenerate(prompt, options);
  }

  /**
   * Generate response (non-streaming)
   */
  async generate(prompt: string, options?: any) {
    const agent = this.getAgent();
    return agent.generate(prompt, options);
  }

  /**
   * Get agent name
   */
  getName(): string {
    return this.getAgent().getName();
  }

  /**
   * Hand off to development agent
   */
  async handoffToDevelop(designSystem: any): Promise<any> {
    const factory = this.getFactory();

    logger.info('design_agent.handoff.develop.start', {
      targetAgent: 'develop'
    });

    const handoffResult = await factory.executeHandoff(
      'design',
      'develop',
      {
        task: 'Implement the design system in the application code',
        context: {
          designSystem,
          implementationNotes: 'Apply design sections to CSS variables, components, and page structure'
        },
        parameters: { designSystem },
        metadata: {
          sourceAgent: 'design',
          timestamp: new Date().toISOString(),
          reason: 'Design system completed, ready for implementation'
        }
      }
    );

    if (handoffResult.success) {
      logger.info('design_agent.handoff.develop.success', {
        targetAgent: 'develop'
      });

      return {
        success: true,
        message: 'Design system handed off to development agent',
        handoffDetails: handoffResult.handoffDetails
      };
    } else {
      logger.error('design_agent.handoff.develop.failure', {
        targetAgent: 'develop',
        error: handoffResult.error
      });
      throw new Error(`Development handoff failed: ${handoffResult.error}`);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('design_agent.cleanup.complete');
  }
}
