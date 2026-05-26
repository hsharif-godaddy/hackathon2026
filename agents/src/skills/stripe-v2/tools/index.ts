/**
 * Stripe Platform Provisioning Tools
 *
 * Wraps the agents-side StripeService client with two SkillToolDefinitions:
 *   - stripe-v2__setup   — provision (or fetch existing) Stripe claimable sandbox
 *   - stripe-v2__status  — read current claim state
 *
 * The `stripe-v2__` prefix is automatic — buildAllSkillTools (packages/ai-skills)
 * derives it from this directory's name. Skill prose (skill.md) and code refer
 * to the prefixed names so the LLM's function catalog and instructions agree.
 *
 * Graceful degradation: when stripe-service returns 502 STRIPE_CREATE_FAILED
 * (the post-#3758 "preview API not enabled" passthrough), tools return a
 * structured `{stripeProvisioningUnavailable: true, ...}` object instead of
 * throwing — so the agent surfaces the message to the user without retrying.
 * Mirrors the buildRetryableOnboardingServiceErrorResult shape used in the
 * commerce skill.
 *
 * Enablement gating happens at LoadSkill time via `enablementId: stripe-v2`
 * in skill.md, NOT at registration time. buildAllSkillTools walks every
 * directory under `agents/src/skills/` and registers these exports
 * unconditionally, so `stripe-v2__setup` and `stripe-v2__status` exist in
 * the AI-SDK registry regardless of `ENABLE_STRIPE_V2`. The only path from
 * registry → LLM today is `LoadSkill`, which gates on `enablementId`. If a
 * future code path surfaces registry tools without going through LoadSkill,
 * gating will need to move to registration.
 */

import { z } from 'zod';
import type { SkillToolDefinition, SkillHooks } from '@airo/ai-skills';

import { logger } from '../../../logging/index.js';
import { stripeService, StripeServiceError } from '../../../services/StripeService.js';
import { loadStripeMcpTools } from '../../../services/mcp/stripe-mcp-client.js';
import { skillToolManager } from '../../../tools/skill-tool-manager.js';

const STRIPE_PROVISIONING_RETRY_SECONDS = 30;

type ToolContext = {
  metadata?: {
    appId?: string;
  };
};

function getAppIdFromContext(context?: ToolContext): string | undefined {
  return context?.metadata?.appId;
}

/**
 * Narrow degrade trigger: only the explicit STRIPE_CREATE_FAILED signal
 * (the post-#3758 "preview API not enabled" passthrough from stripe-service)
 * gets the user-facing graceful-degrade treatment. Generic transport errors
 * (DOMException AbortError/TimeoutError, 5xx with non-JSON body parsed as
 * code='UNKNOWN', etc.) propagate raw to the agent loop so they surface as
 * real errors the agent can decide how to handle. Keep this narrow — broadening
 * would silently swallow problems that aren't the documented preview-disabled
 * case and operators wouldn't see them.
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
 * line still has the upstream-context breadcrumbs. The underlying StripeService
 * already logs `stripe_service.<op>.api_error` separately with full body —
 * this is the skill-layer summary line, not a duplicate.
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

interface SetupInput {
  email: string;
  country: string;
}

export const setupTool: SkillToolDefinition = {
  name: 'setup',
  description:
    'Provision (or fetch the existing) Stripe claimable sandbox for this app. ' +
    'Returns sandboxId, accountId, and claimUrl — share claimUrl with the user so they can complete the claim flow on Stripe. ' +
    'Idempotent on the server: repeated calls for the same app return the same sandbox; never creates duplicates. ' +
    'If the response includes {stripeProvisioningUnavailable: true}, surface its `message` field to the user verbatim and do NOT retry within this conversation.',
  parameters: z.object({
    email: z
      .string()
      .trim()
      .email()
      .describe('Owner email used to prefill the Stripe claim flow. Ask the user; do not invent or default.'),
    country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, 'must be uppercase ISO-3166-1 alpha-2 (e.g. "US", "GB")')
      .describe('Owner country as an ISO-3166-1 alpha-2 code, uppercase (e.g. "US", "GB"). Ask the user; do not default.'),
  }),
  config: {
    requiresApp: true,
    timeout: 30000,
  },
  async execute(input: SetupInput, context?: ToolContext) {
    const appId = getAppIdFromContext(context);
    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    logger.info('skill.stripe_v2.setup.begin', { appId });
    try {
      const sandbox = await stripeService.createSandbox({
        appId,
        email: input.email,
        country: input.country,
      });
      logger.info('skill.stripe_v2.setup.success', { appId, sandboxId: sandbox.sandboxId });
      return {
        success: true,
        sandboxId: sandbox.sandboxId,
        accountId: sandbox.accountId,
        claimUrl: sandbox.claimUrl,
      };
    } catch (err) {
      if (isProvisioningUnavailable(err)) {
        logger.warn('skill.stripe_v2.setup.provisioning_unavailable', {
          appId,
          upstreamStatus: err.status,
        });
        return buildProvisioningUnavailableResult(err);
      }
      logSkillError('skill.stripe_v2.setup.error', appId, err);
      throw err;
    }
  },
};

export const statusTool: SkillToolDefinition = {
  name: 'status',
  description:
    'Read the current Stripe sandbox claim state for this app. ' +
    'Returns {hasStripe: false} when no sandbox has been provisioned yet, otherwise {hasStripe: true, sandboxId, claimStatus, liveAccountId?}. ' +
    'claimStatus advances: provisioned → claimed → live. Read-only and safe to call any time.',
  parameters: z.object({}),
  config: {
    requiresApp: true,
    timeout: 30000,
  },
  async execute(_input: unknown, context?: ToolContext) {
    const appId = getAppIdFromContext(context);
    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    logger.info('skill.stripe_v2.status.begin', { appId });
    try {
      const status = await stripeService.getStatus(appId);
      if (status === null) {
        logger.info('skill.stripe_v2.status.not_found', { appId });
        return { success: true, hasStripe: false };
      }
      logger.info('skill.stripe_v2.status.success', {
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
      };
    } catch (err) {
      // /v1/status doesn't call Stripe so STRIPE_CREATE_FAILED shouldn't
      // surface here. Handle it for parity with setupTool — but log at
      // ERROR (not WARN) since it being non-dead means stripe-service's
      // contract grew a passthrough we didn't expect, which deserves an
      // oncall page rather than a silent degrade.
      if (isProvisioningUnavailable(err)) {
        logger.error('skill.stripe_v2.status.provisioning_unavailable_unexpected', {
          appId,
          upstreamStatus: err.status,
          message: 'STRIPE_CREATE_FAILED on /v1/status — stripe-service contract may have changed',
        });
        return buildProvisioningUnavailableResult(err);
      }
      logSkillError('skill.stripe_v2.status.error', appId, err);
      throw err;
    }
  },
};

/**
 * Stripe-v2 skill lifecycle hooks.
 *
 * onLoad fires from two paths:
 *   1. Pre-fire at agent startup (skill-tool-manager init) — no appId. In
 *      production this is fine: getNomadAllocConfig() resolves to the single
 *      per-alloc config.json since one agent process serves one app. In local
 *      dev there's no single alloc, so loadStripeMcpTools returns {} and the
 *      pre-fire is a no-op; tools are registered when the skill is activated
 *      mid-conversation via the path below.
 *   2. Mid-conversation skill load (skill-loader runHook) — appId is passed
 *      via SkillHookContext, so loadStripeMcpTools can read this app's
 *      per-app config.json under APPS_BASE_DIR/<appId>/local/preview/.
 *
 * When STRIPE_MCP_KEY is not yet available (pre-provisioning, or pre-fire in
 * local dev), loadStripeMcpTools returns {} and registerDynamicTools is a
 * no-op — the skill still works with the static setup/status tools only.
 */
export const hooks: SkillHooks = {
  onLoad: async ({ skillName, appId }) => {
    let mcpTools: Awaited<ReturnType<typeof loadStripeMcpTools>>;
    try {
      mcpTools = await loadStripeMcpTools(appId);
    } catch (err) {
      logger.warn('skill.stripe_v2.onload.mcp_load_failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (Object.keys(mcpTools).length > 0) {
      skillToolManager.registerDynamicTools(skillName, mcpTools);
    }
  },
};
