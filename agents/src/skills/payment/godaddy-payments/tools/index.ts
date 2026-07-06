import { z } from 'zod';
import type { SkillHooks, SkillToolDefinition } from '@airo/ai-skills';

import { logger } from '../../../../logging/index.js';
import {
  callCommerceMcpTool,
  formatToolError,
  isRecord,
} from '../../../commerce/mcp.js';
import { provisionCommerceForApp } from '../../../commerce/provisioning.js';
import { runCheckoutGuardOnWorkspace } from '../../../commerce/checkout-guard-workspace.js';
import type { CommerceCheckoutGuardFindingCode } from '../../../commerce/checkout-guard.js';

const PAYMENT_TEMPLATE_INSTALL_ACTION =
  "skill({ action: 'install', skill: 'payment/godaddy-payments' })";

function logDispatchError(toolName: string, err: unknown): void {
  logger.warn('godaddy_payments_skill.tool.dispatch_error', {
    toolName,
    error: formatToolError(err),
  });
}

export const provisionTool: SkillToolDefinition = {
  name: 'provision',
  description: `Provision the GoDaddy Commerce store/channel required for GoDaddy Payments in one call. Reuses any existing app Commerce binding created by commerce__provision, verifies payment readiness, and writes required env vars automatically.

This provisions payment infrastructure only. It is valid for non-catalog payments, and a ready response does not imply catalog products, SKUs, inventory, carts, storefront UI, or commerce/ui exist.

WHEN TO USE:
- At the start of every GoDaddy Payments setup or checkout flow. Call with no arguments.
- For non-catalog payments such as deposits, donations, tickets, registration fees, tips, custom invoices, retainers, user-entered amounts, and one-off payments. After ready, install the GoDaddy Payments templates and use lineItemData: { name, priceData: { unitAmount, currencyCode } } with /api/commerce/checkout. Redirect browser UI to the returned data.url; there is no data.redirectUrl field. Do not create products/SKUs or install commerce/ui for these flows. Do not use unitPrice/amount/description as price fields.
- After a previous provision call returned a needs_* status and the user answered via askQuestion, re-call with the relevant fields from that answer plus every field from resumeInput when the response includes it.

RETURNS one of:
- { status: 'ready', storeId, channelId } — env vars written and GoDaddy Payments can install checkout templates.
- { status: 'needs_store_choice', stores, resumeInput? } — askQuestion (multiSelect: false, format each as "Store Name (Business Name)", plus a "Create a new store" option unless conflict is 'store_creation_conflict'). Re-call provision with the chosen { storeId } or, when no conflict is present, { storePreference: 'new' }, merged with resumeInput when provided.
- { status: 'needs_business_choice', businesses } — askQuestion (multiSelect: false, one option per business). Re-call with the chosen { businessId }.
- { status: 'needs_identity', resumeInput? } — askQuestion with 3 type:"text" questions: "First name", "Last name", "Email address". Re-call with { firstName, lastName, email } merged with resumeInput when provided.
- { status: 'payments_manual_required', manageUrl } — GoDaddy Payments onboarding is incomplete; direct the user to complete setup at manageUrl.
- { status: 'provisioning_in_progress' } — setup still running; do not re-call yet.

IDEMPOTENT: If commerce__provision already created a channel_ready binding for this app, this tool resumes from that binding instead of asking the user to choose or create a store again.`,
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
      const result = await provisionCommerceForApp(input, context, 'payments');
      if (!isRecord(result) || result.status !== 'ready') return result;

      return {
        ...result,
        NEXT_STEP:
          `GoDaddy Payments is configured and env vars have been written. Before writing any UI or server code, complete these steps in order: (1) If the user's request includes a product catalog, shopping cart, or product listing pages — call commerce__provision now (it will return ready instantly by reusing the binding just created) to enable catalog management tools (search_tools, execute_tool). Then install commerce/ui templates by calling skill({ action: 'install', skill: 'commerce/ui' }). Commerce/ui provides the hooks required to fetch products and manage cart state; writing catalog or cart UI without these templates produces broken pages. (2) Call ${PAYMENT_TEMPLATE_INSTALL_ACTION} to install the checkout and order-status server routes. Do not create checkout or order-status routes manually. (3) Only after all required template installs are complete, write the UI.`,
      };
    } catch (err) {
      logDispatchError('provision', err);
      return `godaddy-payments__provision error: ${formatToolError(err)}`;
    }
  },
};

export const storeListTool: SkillToolDefinition = {
  name: 'store_list',
  description:
    "List every GoDaddy Commerce store that can back GoDaddy Payments for the authenticated customer. Returns each store's storeId, displayName, owning business, and Commerce Home deep link. Use this only for diagnostics or explicit store inspection; normal setup uses provision.",
  parameters: z.object({}),
  config: { timeout: 185_000 },
  async execute(_input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_list', {});
    } catch (err) {
      logDispatchError('store_list', err);
      return `godaddy-payments__store_list error: ${formatToolError(err)}`;
    }
  },
};

export const storeGetTool: SkillToolDefinition = {
  name: 'store_get',
  description:
    'Get metadata for a single GoDaddy Commerce store that can back GoDaddy Payments. Use this only for diagnostics or explicit store inspection.',
  parameters: z.object({
    storeId: z
      .string()
      .trim()
      .min(1)
      .describe('The Commerce store ID to fetch. Must belong to the authenticated customer.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_get', input);
    } catch (err) {
      logDispatchError('store_get', err);
      return `godaddy-payments__store_get error: ${formatToolError(err)}`;
    }
  },
};

export const storeChannelsGetTool: SkillToolDefinition = {
  name: 'store_channels_get',
  description:
    "List all sales channels registered to a GoDaddy Commerce store. Use this only for debugging GoDaddy Payments routing; normal setup uses provision.",
  parameters: z.object({
    storeId: z
      .string()
      .trim()
      .min(1)
      .describe('The Commerce store ID whose channels should be listed.'),
    defaultOnly: z
      .boolean()
      .optional()
      .describe('When true, return only the channel flagged as default for this store.'),
  }),
  config: { timeout: 185_000 },
  async execute(input, context) {
    try {
      return await callCommerceMcpTool(context, 'commerce_store_channels_get', input);
    } catch (err) {
      logDispatchError('store_channels_get', err);
      return `godaddy-payments__store_channels_get error: ${formatToolError(err)}`;
    }
  },
};

export const tools: SkillToolDefinition[] = [
  provisionTool,
  storeListTool,
  storeGetTool,
  storeChannelsGetTool,
];

// These findings require user-written checkout UI to be meaningful.
// At install time no UI exists yet, so they always fire as false positives.
const INSTALL_TIME_FILTERED_CODES = new Set<CommerceCheckoutGuardFindingCode>([
  'order_status_not_wired',
  'success_page_missing_paid_status_gate',
]);

export const hooks: SkillHooks = {
  async onInstall({ appId }) {
    if (!appId) return null;
    try {
      const guardResult = await runCheckoutGuardOnWorkspace(appId);
      if (!guardResult) return null;
      const findings = guardResult.findings.filter((f) => !INSTALL_TIME_FILTERED_CODES.has(f.code));
      return {
        ...guardResult,
        findings,
        status: findings.some((f) => f.severity === 'error') ? 'failed' : 'passed',
        NEXT_STEP:
          'Templates are installed. After writing checkout UI and order-status code, call commerce__validate_checkout to verify the implementation before reporting checkout as complete.',
      };
    } catch (err) {
      logger.warn('godaddy_payments.on_install.checkout_guard_failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
};
