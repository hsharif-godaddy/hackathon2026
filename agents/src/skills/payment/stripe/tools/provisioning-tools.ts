/**
 * Stripe Platform Provisioning Tools
 *
 * `setupTool` and `statusTool` are statically exported and registered at
 * startup — they appear in prepareCall from turn 1, so `stripe__setup` is
 * callable in the same turn the skill loads.
 *
 * The platform-managed (v2) gate lives inside `setupTool.execute`: it reads
 * `profileFlag('skill.stripe-v2.enabled')` at call time and returns
 * `{ autoProvisioningUnavailable: true }` when the flag is off. The skill.md
 * flow selector branches on this result rather than tool presence, keeping the
 * v1/v2 decision entirely in the response and out of the tool registry.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';

import { logger } from '../../../../logging/index.js';
import { profileFlag } from '../../../../profiles/profile-accessor.js';
import { stripeService, StripeServiceError } from '../../../../services/StripeService.js';
import { loadStripeMcpTools } from '../../../../services/mcp/stripe-mcp-client.js';
import { skillToolManager } from '../../../../tools/skill-tool-manager.js';

/** The skill's full namespaced name — matches the key used in the registry. */
export const SKILL_NAME = 'payment/stripe';

/**
 * Per-shopper gate for the v2 platform-managed Stripe flow. Keeps the
 * `stripe-v2` key for switchboard/profile continuity.
 */
const PLATFORM_MANAGED_FLAG = 'skill.stripe-v2.enabled';

const STRIPE_PROVISIONING_RETRY_SECONDS = 30;

// The setup tool's overall execution timeout (build-skill-tools wraps execute
// in a Promise.race against this). It covers BOTH createSandbox and the
// best-effort MCP reload, so the reload must yield enough headroom that
// returning the claimUrl never races the timeout — see MCP_RELOAD_BUDGET_MARGIN_MS.
const SETUP_TIMEOUT_MS = 30000;

// Headroom reserved inside SETUP_TIMEOUT_MS for the synchronous return path.
// The reload skips any attempt that would push past (start + SETUP_TIMEOUT_MS -
// this), so a slow provisioning call can never make the reload trip the tool
// timeout and discard an already-created sandbox's claimUrl.
const MCP_RELOAD_BUDGET_MARGIN_MS = 2000;

// stripe-service accepts the secrets write (including STRIPE_MCP_KEY) before
// `createSandbox` returns, but hosting delivers it into the alloc config.json
// asynchronously — so the key readStripeMcpKey() looks for may not be present
// the instant setup returns. Retry a few times with backoff so the tools get
// registered before the turn ends (they become callable on the agent's NEXT
// turn — see reloadMcpToolsAfterSetup). Total worst-case wait ~5s; the reload
// bails on any attempt that wouldn't fit the remaining setup-timeout budget
// (see MCP_RELOAD_BUDGET_MARGIN_MS) so it never starves the claimUrl return.
const MCP_RELOAD_DELAYS_MS = [0, 2000, 3000];

type ToolContext = {
  metadata?: {
    appId?: string;
    customerId?: string;
  };
};

function getAppIdFromContext(context?: ToolContext): string | undefined {
  return context?.metadata?.appId;
}

/**
 * Best-effort: load the Stripe MCP tools for this app and register them so they
 * become callable on the agent's NEXT turn — without a fresh conversation or
 * process restart. Called after a successful `stripe-v2__setup` (which pushes
 * STRIPE_MCP_KEY into the alloc).
 *
 * NOT same-turn: the agent run snapshots its executable tool map in
 * `prepareCall` (packages/ai-lib agent-factory) before this runs, and
 * `prepareStep` only filters that snapshot — so definitions registered here
 * are picked up at the next turn's `prepareCall`, not the current one. The
 * win is "no new conversation needed", not "usable this instant".
 *
 * Retries with backoff because the key is delivered to config.json
 * asynchronously after provisioning (see MCP_RELOAD_DELAYS_MS). Never throws:
 * if the key hasn't propagated within the retry window, the tools load on the
 * next onLoad — which fires on skill *activation*, so for a continuously-active
 * skill that's the next time it's re-activated (worst case a new conversation).
 * The skill prose keeps the user moving in the meantime. Returns whether the
 * tools were registered.
 *
 * `deadlineMs` bounds the retries inside the caller's setup-timeout budget: any
 * attempt that wouldn't fit is skipped so the reload can't trip the tool timeout
 * and discard the sandbox's claimUrl (see SETUP_TIMEOUT_MS).
 */

/**
 * Narrow degrade trigger: only the explicit STRIPE_CREATE_FAILED signal
 * (the "preview API not enabled" passthrough from stripe-service) gets the
 * user-facing graceful-degrade treatment. Generic transport errors propagate
 * raw to the agent loop so they surface as real errors. Keep this narrow —
 * broadening would silently swallow problems that aren't the documented
 * preview-disabled case.
 */
function isProvisioningUnavailable(err: unknown): err is StripeServiceError {
  return err instanceof StripeServiceError && err.code === 'STRIPE_CREATE_FAILED';
}

function buildProvisioningUnavailableResult(error: StripeServiceError) {
  return {
    stripeProvisioningUnavailable: true,
    retryAfterSeconds: STRIPE_PROVISIONING_RETRY_SECONDS,
    message:
      'Stripe is still being provisioned for this Airo Builder deployment. ' +
      'Tell the user we will turn it on shortly and they should try again later.',
    upstreamCode: error.code,
    upstreamStatus: error.status,
  };
}

/**
 * Self-contained skill error log: enriched with upstream `code`/`status` when
 * the source is a StripeServiceError so an oncall reading just the skill log
 * line still has the upstream-context breadcrumbs.
 */
function logSkillError(event: string, appId: string, err: unknown): void {
  if (err instanceof StripeServiceError) {
    logger.error(event, {
      appId,
      upstreamCode: err.code,
      upstreamStatus: err.status,
      error: err.message,
    });
    return;
  }
  logger.error(event, {
    appId,
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Best-effort: load the Stripe MCP tools for this app and register them so they
 * become callable on the agent's NEXT turn — without a fresh conversation or
 * process restart. Called after a successful `setup` (which pushes
 * STRIPE_MCP_KEY into the alloc).
 *
 * NOT same-turn: the agent run snapshots its executable tool map in
 * `prepareCall` (packages/ai-lib agent-factory) before this runs, and
 * `prepareStep` only filters that snapshot — so definitions registered here
 * are picked up at the next turn's `prepareCall`. The win is "no new
 * conversation needed", not "usable this instant".
 *
 * Retries with backoff because the key is delivered to config.json
 * asynchronously after provisioning (see MCP_RELOAD_DELAYS_MS). Never throws.
 * Returns whether the tools were registered.
 */
export async function reloadMcpToolsAfterSetup(appId: string, deadlineMs: number): Promise<boolean> {
  let sawError = false;
  for (const [attempt, delayMs] of MCP_RELOAD_DELAYS_MS.entries()) {
    if (Date.now() + delayMs > deadlineMs) {
      // Provisioning ate the budget; stop rather than risk the timeout race
      // discarding the already-created sandbox. Tools load on the next onLoad.
      logger.info('skill.stripe.setup.mcp_reload_budget_exhausted', { appId, attempt });
      return false;
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const mcpTools = await loadStripeMcpTools(appId);
      if (Object.keys(mcpTools).length > 0) {
        skillToolManager.registerDynamicTools(SKILL_NAME, mcpTools);
        logger.info('skill.stripe.setup.mcp_tools_registered', {
          appId,
          attempt,
          toolCount: Object.keys(mcpTools).length,
        });
        return true;
      }
    } catch (err) {
      // loadStripeMcpTools already swallows MCP-client failures and returns {};
      // this catch only guards an unexpected throw so it never fails setup.
      sawError = true;
      logger.warn('skill.stripe.setup.mcp_reload_failed', {
        appId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // reason distinguishes the benign race (key still propagating to config.json)
  // from a swallowed load failure, so this terminal line is self-diagnosing.
  logger.info('skill.stripe.setup.mcp_tools_not_ready', {
    appId,
    reason: sawError ? 'mcp_load_error' : 'key_not_propagated',
  });
  return false;
}

interface SetupInput {
  country?: string;
}

export const setupTool: SkillToolDefinition = {
  name: 'setup',
  description:
    'Provision (or fetch the existing) Stripe sandbox for this app. ' +
    'country is optional — call without it first to check flow availability, then provide it when the auto-provisioned flow is active. ' +
    '(1) Returns { sandboxId, accountId, claimUrl } → auto-provisioned flow: keys are in the env, never call requestSecrets. ' +
    '(2) Returns { autoProvisionedFlow: true, needsInputs: true } → auto-provisioned flow confirmed but country required — ask the user and call again. ' +
    '(3) Returns { autoProvisioningUnavailable: true } → manual key flow: collect keys via requestSecrets. ' +
    '(4) Returns { stripeProvisioningUnavailable: true, message } → Stripe API unavailable: surface the message verbatim, do not retry this conversation. ' +
    'Idempotent: repeated calls for the same app return the same sandbox.',
  parameters: z.object({
    country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, 'must be uppercase ISO-3166-1 alpha-2 (e.g. "US", "GB")')
      .optional()
      .describe(
        'Owner country, uppercase ISO-3166-1 alpha-2 (e.g. "US", "GB"). ' +
          'Required for auto-provisioned flow; omit on the first call to check flow availability.',
      ),
  }),
  config: {
    requiresApp: true,
    timeout: SETUP_TIMEOUT_MS,
  },
  computeState(input: SetupInput, output: any) {
    if (!output?.success) return null;
    return {
      provisioned: true,
    };
  },
  async execute(input: SetupInput, context?: ToolContext) {
    const startedAtMs = Date.now();
    const appId = getAppIdFromContext(context);
    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    // Gate: check the per-shopper flag at call time (request-scoped, profile
    // readable). country is optional so the agent can call without it to
    // determine which flow applies first — no upfront questions for manual-key
    // users.
    if (!profileFlag(PLATFORM_MANAGED_FLAG, false)) {
      logger.info('skill.stripe.setup.platform_managed_unavailable', { appId });
      return {
        autoProvisioningUnavailable: true,
        message:
          'Platform-managed Stripe provisioning is not enabled for this account. ' +
          'Use the Manual key flow: collect STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY ' +
          'from the user via requestSecrets, then proceed with template installation.',
      };
    }

    // Country is required for Stripe's SandboxPrefill — ask the user if not provided.
    if (!input.country) {
      logger.info('skill.stripe.setup.inputs_needed', { appId });
      return {
        autoProvisionedFlow: true,
        needsInputs: true,
        message:
          'Auto-provisioned Stripe is available for this account. ' +
          'Ask the user for their country (uppercase ISO-3166-1 alpha-2, e.g. "US"), ' +
          'then call stripe__setup again with that value.',
      };
    }

    const setupStart = Date.now();
    logger.info('skill.stripe.setup.begin', { appId });
    try {
      const sandbox = await stripeService.createSandbox({
        appId,
        customerId: context?.metadata?.customerId,
        country: input.country,
      });
      logger.info('skill.stripe.setup.success', { appId, sandboxId: sandbox.sandboxId });

      // Provisioning just pushed STRIPE_MCP_KEY into the alloc. Register the
      // Stripe MCP catalog tools (create_product, list_products, …) so they're
      // callable on the agent's NEXT turn — no new conversation needed. Not
      // same-turn: the executable tool map for this turn was snapshotted before
      // setup ran (see reloadMcpToolsAfterSetup). Best-effort.
      const mcpToolsReadyNextTurn = await reloadMcpToolsAfterSetup(
        appId,
        setupStart + SETUP_TIMEOUT_MS - MCP_RELOAD_BUDGET_MARGIN_MS,
      );

      return {
        success: true,
        sandboxId: sandbox.sandboxId,
        accountId: sandbox.accountId,
        claimUrl: sandbox.claimUrl,
        // Surface expiries so the LLM can warn the user when either is
        // close. expiresAt: sandbox-level 60-day expiry (unclaimed
        // sandboxes are deleted at this time); claimUrlExpiresAt:
        // 7-day onboarding-link expiry (auto-renewed on the
        // idempotent path; the agent sees freshly-bumped values when
        // it re-calls setup near expiry). Absent on legacy rows that
        // predate the schema; the skill prompt tells the LLM not to
        // act on undefined.
        ...(sandbox.expiresAt && { expiresAt: sandbox.expiresAt }),
        ...(sandbox.claimUrlExpiresAt && { claimUrlExpiresAt: sandbox.claimUrlExpiresAt }),
        // Named to signal next-turn availability so the model doesn't attempt a
        // same-turn MCP call (which would silently no-op against the snapshot).
        mcpToolsReadyNextTurn,
      };
    } catch (err) {
      if (isProvisioningUnavailable(err)) {
        logger.warn('skill.stripe.setup.provisioning_unavailable', {
          appId,
          upstreamStatus: err.status,
        });
        return buildProvisioningUnavailableResult(err);
      }
      logSkillError('skill.stripe.setup.error', appId, err);
      throw err;
    }
  },
};

export const statusTool: SkillToolDefinition = {
  name: 'status',
  description:
    'Read the current Stripe sandbox claim state for this app. ' +
    'Returns {hasStripe: false} when no sandbox has been provisioned yet, otherwise ' +
    '{hasStripe: true, sandboxId, claimStatus, liveAccountId?, expiresAt?, claimUrlExpiresAt?}. ' +
    'claimStatus advances: provisioned → claimed → live. expiresAt is the sandbox 60-day expiry ' +
    '(deleted by Stripe if unclaimed); claimUrlExpiresAt is the 7-day onboarding-link expiry ' +
    '(both RFC3339 UTC; absent for sandboxes provisioned before this schema). Read-only and safe to call any time.',
  parameters: z.object({}),
  config: {
    requiresApp: true,
    timeout: 30000,
  },
  computeState(_input: unknown, output: any) {
    if (!output?.success || !output?.hasStripe) return null;
    return {
      provisioned: true,
      claimStatus: output.claimStatus,
    };
  },
  async execute(_input: unknown, context?: ToolContext) {
    const appId = getAppIdFromContext(context);
    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    logger.info('skill.stripe.status.begin', { appId });
    try {
      const status = await stripeService.getStatus(appId);
      if (status === null) {
        logger.info('skill.stripe.status.not_found', { appId });
        return { success: true, hasStripe: false };
      }
      logger.info('skill.stripe.status.success', {
        appId,
        sandboxId: status.sandboxId,
        claimStatus: status.claimStatus,
      });
      return {
        success: true,
        hasStripe: true,
        sandboxId: status.sandboxId,
        claimStatus: status.claimStatus,
        ...(status.liveAccountId && { liveAccountId: status.liveAccountId }),
        // Surface expiries — see setupTool for context on these fields.
        ...(status.expiresAt && { expiresAt: status.expiresAt }),
        ...(status.claimUrlExpiresAt && { claimUrlExpiresAt: status.claimUrlExpiresAt }),
      };
    } catch (err) {
      // /v1/status doesn't call Stripe so STRIPE_CREATE_FAILED shouldn't
      // surface here. Handle it for parity with setupTool — but log at
      // ERROR (not WARN) since it being non-dead means stripe-service's
      // contract grew a passthrough we didn't expect, which deserves an
      // oncall page rather than a silent degrade.
      if (isProvisioningUnavailable(err)) {
        logger.error('skill.stripe.status.provisioning_unavailable_unexpected', {
          appId,
          upstreamStatus: err.status,
          message: 'STRIPE_CREATE_FAILED on /v1/status — stripe-service contract may have changed',
        });
        return buildProvisioningUnavailableResult(err);
      }
      logSkillError('skill.stripe.status.error', appId, err);
      throw err;
    }
  },
};
