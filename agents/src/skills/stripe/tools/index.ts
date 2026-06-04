/**
 * Stripe skill tool wiring.
 *
 * `setup` and `status` are STATIC exports — buildAllSkillTools registers them
 * at startup so they are in the prepareCall snapshot from turn 1. This is the
 * critical design choice that makes `stripe__setup` callable in the same turn
 * the skill loads, with no multi-turn workaround.
 *
 * The platform-managed (v2) vs legacy (v1) gate lives inside `setupTool.execute`
 * itself: it calls profileFlag at execution time (request-scoped, profile
 * readable) and returns `{ platformManagedUnavailable: true }` when the flag is
 * off. The skill.md flow selector branches on the *result* of calling setup, not
 * on whether the tool is present or absent. All stripe shoppers see the tool;
 * the flag determines what it does.
 *
 * MCP catalog tools (create_product, list_products, …) remain dynamic via
 * onLoad — they're only available after a sandbox is provisioned, so the
 * next-turn delay there is natural and expected.
 */

import type { SkillHooks } from '@airo/ai-skills';

import { logger } from '../../../logging/index.js';
import { loadStripeMcpTools } from '../../../services/mcp/stripe-mcp-client.js';
import { skillToolManager } from '../../../tools/skill-tool-manager.js';

export { setupTool, statusTool } from './provisioning-tools.js';

/**
 * Stripe skill lifecycle hooks.
 *
 * onLoad fires (1) at agent startup with no profile context — flag reads false,
 * loadStripeMcpTools returns {}, this is a safe no-op; and (2) on mid-
 * conversation skill load where the agent loop runs inside `runWithProfile` so
 * the flag is readable and `appId` is in context.
 *
 * We only load MCP tools here — setup/status are static and already in the
 * registry. When STRIPE_MCP_KEY is not yet available (pre-provisioning),
 * loadStripeMcpTools returns {} and this is a no-op. Tools load once the
 * sandbox is provisioned and reloadMcpToolsAfterSetup registers them.
 */
export const hooks: SkillHooks = {
  onLoad: async ({ skillName, appId }) => {
    let mcpTools: Awaited<ReturnType<typeof loadStripeMcpTools>> = {};
    try {
      mcpTools = await loadStripeMcpTools(appId);
    } catch (err) {
      logger.warn('skill.stripe.onload.mcp_load_failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (Object.keys(mcpTools).length > 0) {
      skillToolManager.registerDynamicTools(skillName, mcpTools);
    }
  },
};
