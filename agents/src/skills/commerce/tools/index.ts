import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';

import { logger } from '../../../logging/index.js';
import { GODADDY_PAYMENTS_TEMPLATE_PATHS } from '../checkout-guard.js';
import { runCheckoutGuardOnWorkspace } from '../checkout-guard-workspace.js';
import { readCurrentCommerceBinding } from '../binding.js';
import { callCommerceMcpTool, formatToolError, isRecord, requireAppId } from '../mcp.js';
import { provisionCommerceForApp } from '../provisioning.js';

export { mergeEnvContent } from '../binding.js';

const COMMERCE_UI_TEMPLATE_LOAD_ACTION = "skill({ action: 'load', skill: 'commerce/ui' })";
const COMMERCE_UI_TEMPLATE_INSTALL_ACTION = "skill({ action: 'install', skill: 'commerce/ui' })";
const PAYMENT_ROUTER_LOAD_ACTION = "skill({ action: 'load', skill: 'payment' })";

function buildCommerceCapabilityChecklists(): Record<string, unknown> {
  const commerceProvisioned = {
    id: 'commerce_store_channel_ready',
    status: 'complete',
    evidence: 'commerce__provision returned status: ready',
  };
  const commerceUiTemplates = {
    id: 'commerce_ui_templates_installed',
    status: 'required',
    requiredAction: COMMERCE_UI_TEMPLATE_INSTALL_ACTION,
    mustCompleteBefore: [
      'catalog UI',
      'product detail UI',
      'cart UI',
      'Commerce product/cart hooks',
    ],
  };
  const catalogDataDecision = {
    id: 'catalog_data_decision',
    status: 'required',
    requiredAction:
      'Inspect or decide catalog data before reporting a storefront complete. If the user provided products, use commerce__search_tools and commerce__execute_tool to create/update catalog data. If the catalog is empty and no products were provided, ask whether to create starter products with the agent, manage products in Commerce Home, or continue with an empty catalog.',
    mustCompleteBefore: [
      'final product catalog UI',
      'final product detail UI',
      'final cart UI',
      'reporting the storefront as complete',
    ],
  };
  const paymentRegionChecked = {
    id: 'payment_region_checked_before_provider_selection',
    status: 'required',
    requiredAction: `${PAYMENT_ROUTER_LOAD_ACTION}; determine or ask for the merchant selling country before selecting a provider. Commerce cart checkout is currently supported only through GoDaddy Payments for confirmed US/CA merchants. For non-US/Canada merchants, do not build Commerce cart checkout UI; explain that GoDaddy Payments checkout is unavailable in their region and recommend Stripe or another third-party processor for a non-Commerce payment flow.`,
  };
  const paymentProviderProvisioned = {
    id: 'eligible_payment_provider_provisioned',
    status: 'required',
    requiredAction:
      'Follow the payment router. For US/CA Commerce cart checkout, load payment/godaddy-payments with sellingCountry and run godaddy-payments__provision. For non-US/CA Commerce cart checkout, stop before checkout UI and recommend Stripe or another third-party processor as an alternate non-Commerce payment flow; do not provision GoDaddy Payments.',
    mustCompleteBefore: ['checkout UI', 'checkout buttons', 'checkout pages', 'order-status code'],
  };
  const paymentProviderTemplates = {
    id: 'eligible_payment_provider_templates_installed',
    status: 'required',
    requiredAction:
      'Install only the templates for the eligible provider selected by the payment router. GoDaddy Payments templates require confirmed US/CA sellingCountry; never install them for non-US/CA merchants.',
    mustCompleteBefore: [
      'checkout UI',
      'checkout buttons',
      'checkout pages',
      'checkout server routes',
      'order-status code',
    ],
  };
  const cartCheckoutWiring = {
    id: 'us_ca_godaddy_payments_cart_checkout_wired_to_installed_route',
    status: 'required',
    contract: {
      supportedProvider: 'GoDaddy Payments for confirmed US/CA merchants only',
      request: { draftOrderId: 'cart.id', returnUrl: 'string', successUrl: 'string' },
      response: { url: 'string', id: 'string', draftOrderId: 'string | null' },
      redirectField: 'url',
    },
    requiredAction:
      'Only after confirmed US/CA GoDaddy Payments provision and template install, call POST /api/commerce/checkout with draftOrderId, returnUrl, and successUrl, then redirect to data.url. For non-US/CA merchants, do not build this checkout surface; explain the region limitation and recommend Stripe or another third-party processor for a non-Commerce payment flow.',
  };

  return {
    catalogOrCartUi: [commerceProvisioned, commerceUiTemplates, catalogDataDecision],
    fullShopWithCheckout: [
      commerceProvisioned,
      commerceUiTemplates,
      catalogDataDecision,
      paymentRegionChecked,
      paymentProviderProvisioned,
      paymentProviderTemplates,
      cartCheckoutWiring,
    ],
    nonCatalogPayment: [
      commerceProvisioned,
      paymentRegionChecked,
      paymentProviderProvisioned,
      paymentProviderTemplates,
      {
        id: 'non_catalog_checkout_wired_to_installed_route',
        status: 'required',
        contract: {
          request: {
            lineItemData: {
              name: 'string',
              priceData: { unitAmount: 'number', currencyCode: 'USD' },
            },
            quantity: 'number',
            returnUrl: 'string',
            successUrl: 'string',
          },
          response: { url: 'string', id: 'string', draftOrderId: null },
          redirectField: 'url',
        },
      },
    ],
  };
}

function logDispatchError(toolName: string, err: unknown): void {
  logger.warn('commerce_skill.tool.dispatch_error', {
    toolName,
    error: formatToolError(err),
  });
}

export const searchToolsTool: SkillToolDefinition = {
  name: 'search_tools',
  description: `Search the GoDaddy Commerce MCP server for tools matching a natural-language query.

WHEN TO USE:
- Before calling execute_tool, to find the right Commerce MCP tool name and parameters
- When the user asks a commerce question and you don't already know which MCP tool to call
- When you need to inspect a Commerce tool's parameter schema or required scopes

WORKFLOW:
1. Call search_tools with a short query describing the task ("create a product", "list orders for a store", "enable payments")
2. Inspect the returned tools. Each tool description and parameter schema comes from the Commerce MCP server.
3. Choose one and call execute_tool with its name and arguments

RETURNS:
- { tools, relatedTools, query, totalFound }
- Each item in tools has: name, description, parameters (JSON schema), scopesRequired, category

NOTES:
- This only returns candidate tools; it does not execute anything
- Authentication happens automatically through the AAB browser/BFF bridge
- No extra commerce scopes are required for discovery itself`,
  parameters: z.object({
    query: z
      .string()
      .min(1)
      .max(500)
      .describe('Natural-language description of the task you want to accomplish'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of tools to return, 1-20 (default: server-controlled)'),
    category: z
      .string()
      .optional()
      .describe(
        "Optional MCP category filter, such as 'catalog', 'orders', 'reporting', 'store', or 'meta'"
      ),
    includeCoreTools: z
      .boolean()
      .optional()
      .describe('Whether to include core tools in results. Defaults to the MCP server default.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      return await callCommerceMcpTool(context, 'search_tools', {
        query: input.query,
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(typeof input.category === 'string' && input.category.length > 0
          ? { category: input.category }
          : {}),
        ...(typeof input.includeCoreTools === 'boolean'
          ? { includeCoreTools: input.includeCoreTools }
          : {}),
      });
    } catch (err) {
      logDispatchError('search_tools', err);
      return `commerce__search_tools error: ${formatToolError(err)}`;
    }
  },
};

export const executeToolTool: SkillToolDefinition = {
  name: 'execute_tool',
  description: `Execute a Commerce data tool discovered via search_tools (catalog, inventory, orders, pricing).

This is NOT for store setup or channel provisioning — use commerce__provision for that.

WHEN TO USE:
- After commerce__provision returns status 'ready' AND search_tools has returned a matching data tool

WORKFLOW:
1. Pass the tool name from search_tools as 'name'
2. Pass the argument object matching the tool's parameter JSON schema as 'arguments'
3. storeId is auto-injected from the connected store — you do not need to pass it
4. The returned value is the MCP tool's structured data. MCP errors include isError/errors/content.

IMPORTANT:
- Do not call execute_tool or search_tools recursively through this tool
- If the call fails with an auth / scope error, surface it to the user; do not retry blindly
- Destructive or sensitive tools (create/update/delete) require user confirmation first when appropriate`,
  parameters: z.object({
    name: z.string().min(1).describe('The exact Commerce MCP tool name returned from search_tools'),
    arguments: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe(
        "Arguments object matching the tool's parameter schema. Prefer an object; a JSON-encoded string is accepted and parsed."
      ),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    let argumentsObject: Record<string, unknown> = {};
    if (typeof input.arguments === 'string') {
      try {
        const parsed = JSON.parse(input.arguments);
        if (!isRecord(parsed)) {
          return `commerce__execute_tool error: arguments string did not parse to a JSON object`;
        }
        argumentsObject = parsed;
      } catch (err) {
        return `commerce__execute_tool error: arguments string is not valid JSON: ${formatToolError(err)}`;
      }
    } else if (input.arguments) {
      argumentsObject = input.arguments;
    }

    if (input.name === 'commerce_app_channel_ensure') {
      return `commerce__execute_tool error: use commerce__provision for Airo App Builder channel setup`;
    }

    if (!argumentsObject.storeId) {
      const binding = readCurrentCommerceBinding(context);
      if (binding?.storeId) {
        argumentsObject.storeId = binding.storeId;
      }
    }

    try {
      return await callCommerceMcpTool(context, 'execute_tool', {
        tool: input.name,
        arguments: argumentsObject,
      });
    } catch (err) {
      logDispatchError('execute_tool', err);
      return `commerce__execute_tool error: ${formatToolError(err)}`;
    }
  },
};

export const commerceProvisionTool: SkillToolDefinition = {
  name: 'provision',
  description: `Provision a GoDaddy Commerce store for this app in one call: runs store setup, ensures the Airo App Builder channel, persists the binding, and writes the required env vars automatically.

WHEN TO USE:
- At the start of every Commerce setup flow. Call with no arguments.
- After a previous provision call returned a needs_* status and the user answered via askQuestion, re-call with the relevant fields from that answer plus every field from resumeInput when the response includes it.

RETURNS one of:
- { status: 'ready', storeId, channelId } — env vars written, Commerce is configured. Classify intent and proceed to catalog tools or template installation.
- { status: 'needs_store_choice', stores, resumeInput? } — askQuestion (multiSelect: false, format each as "Store Name (Business Name)", plus a "Create a new store" option unless conflict is 'store_creation_conflict'). Re-call provision with the chosen { storeId } or, when no conflict is present, { storePreference: 'new' }, merged with resumeInput when provided.
- { status: 'needs_business_choice', businesses } — askQuestion (multiSelect: false, one option per business). Re-call with the chosen { businessId }.
- { status: 'needs_identity', resumeInput? } — askQuestion with 3 type:"text" questions: "First name", "Last name", "Email address". Re-call with { firstName, lastName, email } merged with resumeInput when provided.
- { status: 'provisioning_in_progress' } — setup still running; do not re-call yet.

IDEMPOTENT: Re-calling with the same or additional inputs resumes from the last persisted state. Once a Commerce binding is channel_ready, this tool returns ready without asking the user to choose a store again unless explicit switch/create inputs are provided.`,
  parameters: z.object({
    storeId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Pass after user picks an existing store from a needs_store_choice response.'),
    businessId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Pass after user picks a business from a needs_business_choice response.'),
    storePreference: z
      .enum(['existing', 'new'])
      .optional()
      .describe('Pass "new" to create a new store, "existing" to reuse a discovered store.'),
    firstName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Store owner first name. Required when needs_identity is returned.'),
    lastName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Store owner last name. Required when needs_identity is returned.'),
    email: z
      .string()
      .trim()
      .email()
      .optional()
      .describe('Store owner email. Required when needs_identity is returned.'),
    storeName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional store name for new store creation.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      const result = await provisionCommerceForApp(input, context, 'commerce');
      if (!isRecord(result) || result.status !== 'ready') return result;

      return {
        ...result,
        NEXT_STEP: `Commerce is configured and env vars have been written. Classify the user's original request. For catalog, product detail, shop, or cart UI, the next skill calls must be ${COMMERCE_UI_TEMPLATE_LOAD_ACTION} and then ${COMMERCE_UI_TEMPLATE_INSTALL_ACTION} before writing UI, catalog hooks, or Commerce API routes. After templates are installed, use commerce__search_tools and commerce__execute_tool for requested product/catalog/inventory work. If the catalog is empty and the user did not provide products, ask whether to create starter products with the agent, manage products in Commerce Home, or continue with an empty catalog. Include the Commerce Home link from commerceHomeUrl or selectedCommerceResources.storeUrl when available. CRITICAL: If the user's request contains ANY cart, checkout button, buy button, hosted checkout, place order, or order confirmation — load the payment router first with ${PAYMENT_ROUTER_LOAD_ACTION} and determine the merchant selling country before provider selection. Commerce cart checkout is currently supported only through GoDaddy Payments for confirmed US/CA merchants. For non-US/Canada merchants, do not load, provision, or install payment/godaddy-payments and do not build Commerce checkout UI; explain that GoDaddy Payments checkout is unavailable in their region and recommend Stripe or another third-party processor for a non-Commerce payment flow. Only for confirmed US/CA one-time checkout should you follow the GoDaddy Payments flow with sellingCountry, then wire Commerce checkout after provision and templates succeed. A cart checkout button wired to nothing is a broken app — do not deliver it.`,
        capabilityChecklists: buildCommerceCapabilityChecklists(),
      };
    } catch (err) {
      logDispatchError('commerce_provision', err);
      return `commerce__provision error: ${formatToolError(err)}`;
    }
  },
};

export const validateCheckoutTool: SkillToolDefinition = {
  name: 'validate_checkout',
  description: `Validate Commerce cart/checkout implementation before reporting checkout as complete.

WHEN TO USE:
- After implementing cart checkout, buy buttons, order confirmation, or any UI that calls /api/commerce/checkout.
- Before final response for a Commerce request that included checkout.

CHECKS:
- payment/godaddy-payments checkout templates are installed when confirmed US/CA Commerce checkout is expected.
- frontend code redirects to data.url, not data.redirectUrl.
- no manual checkout/order-status routes were created outside the installed template paths.
- no replacement shipping/place-order/order-completion APIs were built instead of hosted checkout.

RETURNS:
- { status: 'passed', findings: [] } when the checkout surface matches the skill contract.
- { status: 'failed', findings } with actionable errors when the implementation violates the contract.`,
  parameters: z.object({
    expectCheckout: z
      .boolean()
      .optional()
      .describe('Set true when the user asked for checkout. Defaults to true.'),
  }),
  config: { timeout: 185_000, requiresApp: true },
  async execute(input, context) {
    try {
      const appId = requireAppId(context);
      const result = await runCheckoutGuardOnWorkspace(appId, input.expectCheckout ?? true);
      if (!result) {
        return `commerce__validate_checkout error: workspace not available for app ${appId}`;
      }
      return {
        ...result,
        requiredTemplatePaths: GODADDY_PAYMENTS_TEMPLATE_PATHS,
        NEXT_STEP:
          result.status === 'passed'
            ? 'Checkout guard passed. Continue with functional preview verification.'
            : 'Fix every checkout guard finding before reporting checkout as complete.',
      };
    } catch (err) {
      logDispatchError('validate_checkout', err);
      return `commerce__validate_checkout error: ${formatToolError(err)}`;
    }
  },
};

export const tools: SkillToolDefinition[] = [
  commerceProvisionTool,
  searchToolsTool,
  executeToolTool,
  validateCheckoutTool,
];
