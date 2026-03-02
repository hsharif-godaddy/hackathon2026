import {
  createAgentFactory,
  type AgentConfig,
  type BeforeToolExecutionHook,
  type AfterToolExecutionHook,
  createPromptBuilder,
} from '@airo/ai-lib';
import { getAgentModelWithName } from '../utils/model-selection.js';
import {
  commerceStore,
  commerceSetupIntegration,
  commerceSearchSkuGroups,
  commerceSkuGroup,
  commerceSku,
  commerceInventory,
  commerceSkuGroupMedia,
  commerceOrders,
} from '../tools/ai-lib-tools/commerce-tools.js';
import { getModularPromptPaths } from '../utils/prompt-utils.js';
import { Logger } from '../logging/index.js';
import { oauthConnect } from '../tools/ai-lib-tools/oauth-tool.js';
import { suggestedResponseAITool } from '../tools/ai-lib-tools/suggested-response.js';
import { mediaSlotAITool } from '../tools/ai-lib-tools/media-slot.js';
import { createAgentTelemetryLogger } from '../utils/agent-logger.js';

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
    .file(paths.getAgentFile('commerce', 'communication.md'))
    .file(paths.getSharedFile('security.md'));

  return await promptBuilder.build();
}

/**
 * Create the Commerce Agent configuration
 */
export async function createCommerceAgent(_options?: { appPath?: string }): Promise<AgentConfig> {
  const systemPrompt = await buildCommerceSystemPrompt();
  const { model, modelName } = await getAgentModelWithName('fast'); // Use fast model for simple data retrieval

  return {
    id: 'commerce',
    name: 'Commerce Agent',
    system: systemPrompt,
    model,
    modelName,
    tools: {
      oauthConnect,
      store: commerceStore,
      setupIntegration: commerceSetupIntegration,
      searchSkuGroups: commerceSearchSkuGroups,
      skuGroup: commerceSkuGroup,
      sku: commerceSku,
      inventory: commerceInventory,
      skuGroupMedia: commerceSkuGroupMedia,
      orders: commerceOrders,
      media: mediaSlotAITool,
      suggestedResponse: suggestedResponseAITool,
    },

    // Tool execution hooks
    beforeToolExecution,
    afterToolExecution,
    logger: createAgentTelemetryLogger('commerce'),

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
    timeout: { stepMs: 60_000, chunkMs: 30_000 },

    // Enable prompt caching for cost savings
    // Commerce agent has large system prompt (~6K tokens) with detailed product catalog instructions
    enablePromptCaching: true,
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
   * @param params.products - Product data array
   * @param params.instructions - Optional custom instructions
   * @param params.flow - 'storefront' for @godaddy/react components, 'payment' for manual HTML
   * @param params.storeConfig - Store configuration (storeId, channelId, clientId, apiHost)
   */
  async handoffToDevelop(params: {
    products: any[];
    instructions?: string;
    flow?: 'storefront' | 'payment';
    storeConfig?: {
      storeId: string;
      channelId: string;
      clientId: string;
      apiHost: string;
    };
  }): Promise<any> {
    const factory = this.getFactory();
    const flow = params.flow || 'storefront';

    logger.info('commerce_agent.handoff.develop.start', {
      targetAgent: 'develop',
      productCount: params.products.length,
      flow,
    });

    let defaultInstructions: string;

    if (flow === 'storefront') {
      defaultInstructions = `## FLOW_TYPE: STOREFRONT_COMPONENTS

**You MUST use \`@godaddy/react\` components. DO NOT render products manually.**

### Required Setup:
1. Install dependencies: \`@godaddy/react\`, \`@godaddy/localizations\`, \`@tanstack/react-query\`
2. In layout.tsx, import styles: \`import '@godaddy/react/styles-tailwind.css';\` (AFTER globals.css)
3. **CRITICAL**: Write these values to the app's \`.env\` file:
   - Read \`GODADDY_OAUTH_CLIENT_ID\` value from \`/alloc/config.json\` (GODADDY_OAUTH_CLIENT_ID.VALUE field)
   - Read \`GODADDY_API_BASE_URL\` value from current \`.env\` file
   - Extract hostname from \`GODADDY_API_BASE_URL\` by stripping the protocol (\`https://\` or \`http://\`)
   - Add these lines to \`.env\`:
   \`\`\`bash
   # GoDaddy Commerce Storefront Configuration
   VITE_GODADDY_CLIENT_ID=<value-from-/alloc/config.json>
   VITE_GODADDY_API_HOST=<hostname-from-GODADDY_API_BASE_URL>
   \`\`\`
   Example: if GODADDY_API_BASE_URL is \`https://api.dev-godaddy.com\`, write \`VITE_GODADDY_API_HOST=api.dev-godaddy.com\`
4. Wrap app in \`GoDaddyProvider\` with these values:
   - storeId: "${params.storeConfig?.storeId || 'REPLACE_WITH_STORE_ID'}" (hardcode this value)
   - channelId: "${params.storeConfig?.channelId || 'REPLACE_WITH_CHANNEL_ID'}" (hardcode this value)
   - clientId: import.meta.env.VITE_GODADDY_CLIENT_ID (read from env var)
   - apiHost: import.meta.env.VITE_GODADDY_API_HOST (read from env var, no https://)

### Required Components:
- \`ProductGrid\` - For catalog pages (fetches data automatically)
- \`ProductDetails\` - For single product pages (fetches data automatically)
- \`Cart\` - For shopping cart with checkout

### Cart onCheckout Handler (CRITICAL):
The Cart component's \`onCheckout\` prop receives an \`orderId: string\` parameter.
You MUST call the backend with \`draftOrderId: orderId\`:
\`\`\`tsx
const [isCheckingOut, setIsCheckingOut] = useState(false);
const handleCheckout = async (orderId: string) => {
  setIsCheckingOut(true);
  const previewUrl = import.meta.env.VITE_PREVIEW_URL || 'https://dummy.godaddy.com';
  const response = await fetch('/api/commerce/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: '${params.storeConfig?.storeId || 'YOUR_STORE_ID'}',
      draftOrderId: orderId,
      returnUrl: \`\${previewUrl}/checkout/success\`,
      successUrl: \`\${previewUrl}/checkout/success\`,
    }),
  });
  const result = await response.json();
  if (result.checkoutUrl) window.location.href = result.checkoutUrl;
  setIsCheckingOut(false);
};
\`\`\`

**DO NOT render product cards manually from the products array. The components fetch their own data.**`;
    } else {
      defaultInstructions = `## FLOW_TYPE: PAYMENT_SIMPLE

Render these products in an HTML interface with the following requirements:
- Display label, description, and price for each product
- Add a form or button for each product to initiate checkout
- Use the SKU ID (products[i].skus[j].id) as the skuId parameter
- Style appropriately for the application's design system
- Create checkout pages following the commerce-checkout-guide.md patterns

Store Configuration:
- storeId: "${params.storeConfig?.storeId || 'REPLACE_WITH_STORE_ID'}"`;
    }

    const handoffResult = await factory.executeHandoff('commerce', 'develop', {
      task: params.instructions || defaultInstructions,
      context: {
        products: params.products,
        appPath: this.appPath,
        totalProducts: params.products.length,
        flow,
        storeConfig: params.storeConfig,
      },
      parameters: params,
      metadata: {
        sourceAgent: 'commerce',
        timestamp: new Date().toISOString(),
        reason:
          flow === 'storefront'
            ? 'Storefront implementation with @godaddy/react components'
            : 'Manual product rendering with checkout buttons',
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
