import {
  createAgentFactory,
  type AgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  createPromptBuilder,
} from '@airo/ai-lib';
import { getAgentModelWithName } from '../utils/model-selection.js';
import {
  commerceGetStore,
  commerceSetupStore,
  commerceSearchStoreProducts,
  commerceAddStoreProducts,
} from '../tools/ai-lib-tools/commerce-tools.js';
import { getModularPromptPaths } from '../utils/prompt-utils.js';
import { Logger } from '../logging/index.js';
import { oauthConnect } from '../tools/ai-lib-tools/oauth-tool.js';
import { writeCommerceCredentials } from '../tools/ai-lib-tools/commerce-credentials.js';

const logger = Logger.create({ service: 'commerce-agent' });

/**
 * Commerce Agent - Product catalog operations and commerce setup
 *
 * This agent is responsible for:
 * 1. Managing OAuth authentication for GoDaddy Commerce API
 * 2. Onboarding new stores to GoDaddy Commerce
 * 3. Fetching and managing product catalogs from GoDaddy Commerce API
 * 4. Handing off product data to Develop Agent for HTML rendering
 *
 * It does NOT:
 * - Render HTML or create UI (Develop Agent's responsibility)
 * - Create or edit application files (Develop Agent's responsibility)
 * - Make design decisions
 */

/**
 * Before tool execution hook for commerce operations
 */
const beforeToolExecution: BeforeToolExecutionHook = async (
  toolName: string,
  args: unknown
): Promise<unknown> => {
  logger.info('commerce_agent.tool.execution.start', {
    toolName,
  });

  return args;
};

/**
 * After tool execution hook for tracking commerce operations
 */
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown
): Promise<unknown> => {
  logger.info('commerce_agent.tool.execution.complete', {
    toolName,
  });

  return result;
};

/**
 * Build the system prompt for the Commerce Agent
 */
async function buildCommerceSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder();

  // Get modular prompt paths using helper utility
  const paths = getModularPromptPaths(import.meta.url);

  // Load all modular prompt sections in order
  promptBuilder
    .file(paths.getAgentFile('commerce', 'core.md'))
    .file(paths.getAgentFile('commerce', 'handoff-protocol.md'))
    .file(paths.getAgentFile('commerce', 'communication.md'));

  return await promptBuilder.build();
}

/**
 * Create the Commerce Agent configuration
 */
export async function createCommerceAgent(options?: { appPath?: string }): Promise<AgentConfig> {
  const systemPrompt = await buildCommerceSystemPrompt();
  const { model, modelName } = await getAgentModelWithName('fast'); // Use fast model for simple data retrieval

  return {
    name: 'Commerce Agent',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      oauthConnect,
      getStore: commerceGetStore,
      setupStore: commerceSetupStore,
      searchProducts: commerceSearchStoreProducts,
      addStoreProducts: commerceAddStoreProducts,
      writeCommerceCredentials,
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,

    // Handoff configuration
    handoffs: [
      {
        agentName: 'develop',
        description:
          'Hand off product data to Develop Agent for HTML rendering and UI implementation',
      },
    ],

    maxSteps: 10, // Simple workflow: fetch → hand off
    temperature: 0.3,
    maxOutputTokens: 2000,
  };
}

/**
 * Create Commerce Agent factory
 */
export async function createCommerceAgentFactory(options?: { appPath?: string }) {
  const factory = createAgentFactory();

  const agents = factory.defineAgents({
    commerce: await createCommerceAgent(options),
  });

  return {
    factory,
    agents,
    getAgent: () => agents.get('commerce'),
    appPath: options?.appPath,
  };
}

/**
 * Commerce Agent class wrapper for backward compatibility
 */
export class CommerceAgent {
  private factory: Awaited<ReturnType<typeof createCommerceAgentFactory>>;
  private appPath: string;

  constructor(options?: { appPath?: string }) {
    this.appPath = options?.appPath || process.cwd();
    this.factory = null as any;
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    logger.info('commerce_agent.initialization.start', {
      appPath: this.appPath,
    });
    this.factory = await createCommerceAgentFactory({ appPath: this.appPath });
    logger.info('commerce_agent.initialization.complete', {
      appPath: this.appPath,
    });
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
   * Hand off to Develop Agent for HTML rendering
   */
  async handoffToDevelop(params: { products: any[]; instructions?: string }): Promise<any> {
    const factory = this.getFactory();

    logger.info('commerce_agent.handoff.develop.start', {
      targetAgent: 'develop',
      productCount: params.products.length,
    });

    const defaultInstructions = `Render these products in an HTML interface with the following requirements:
- label, description, and price for each product
- Add a form or button for each product to initiate checkout
- Use the SKU ID in the form (as hidden field or data attribute)
- Style appropriately for the application's design system
- Note: Checkout URL will be provided in future implementation`;

    const handoffResult = await factory.executeHandoff('commerce', 'develop', {
      task: params.instructions || defaultInstructions,
      context: {
        products: params.products,
        appPath: this.appPath,
        totalProducts: params.products.length,
      },
      parameters: params,
      metadata: {
        sourceAgent: 'commerce',
        timestamp: new Date().toISOString(),
        reason: 'Product catalog HTML rendering required',
      },
    });

    if (handoffResult.success) {
      logger.info('commerce_agent.handoff.develop.success', {
        targetAgent: 'develop',
        productCount: params.products.length,
      });

      return {
        success: true,
        message: 'Successfully handed off product data to Develop Agent for HTML rendering',
        handoffDetails: handoffResult.handoffDetails,
      };
    } else {
      logger.error('commerce_agent.handoff.develop.failure', {
        targetAgent: 'develop',
        productCount: params.products.length,
        error: handoffResult.error,
      });
      throw new Error(`Handoff to Develop Agent failed: ${handoffResult.error}`);
    }
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
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }
    return this.factory.agents.getConfig('commerce');
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('commerce_agent.cleanup.complete', {
      appPath: this.appPath,
    });
  }
}
