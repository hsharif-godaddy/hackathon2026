/**
 * Stripe skill tool wiring.
 *
 * `setup` and `status` are STATIC exports — buildAllSkillTools registers them
 * at startup so they are in the prepareCall snapshot from turn 1. This is the
 * critical design choice that makes `stripe__setup` callable in the same turn
 * the skill loads, with no multi-turn workaround.
 *
 * Auto-provisioning is the only flow. `setupTool.execute` calls stripe-service
 * `createSandbox`, which returns either `{mode: 'managed', sandbox...}` for new
 * apps or `{mode: 'legacy', message}` for apps that already had a pasted key
 * before auto-provisioning existed (detected server-side via a `legacy` row).
 * skill.md branches on the response shape; both modes share Step 2 onward.
 *
 * MCP catalog tools are intentionally disabled (see MCP_TOOLS_ENABLED).
 * Product registration goes through the bundled `stripe-register-products.ts`
 * script for both managed and legacy modes — that script reads
 * STRIPE_SECRET_KEY from the alloc env, so it works on test or live keys
 * automatically depending on the current sandbox state.
 */

import type { SkillHooks } from '@airo/ai-skills';

import { logger } from '../../../../logging/index.js';
import { loadStripeMcpTools } from '../../../../services/mcp/stripe-mcp-client.js';
import { skillToolManager } from '../../../../tools/skill-tool-manager.js';

export { setupTool, statusTool, MCP_TOOLS_ENABLED } from './provisioning-tools.js';

import { MCP_TOOLS_ENABLED } from './provisioning-tools.js';

/**
 * The Stripe MCP catalog tools (`stripe__create_product`, `stripe__list_products`,
 * etc.) are disabled via the `MCP_TOOLS_ENABLED = false` flag in
 * `provisioning-tools.ts`. Reasons:
 *
 * 1. The agent struggled to reason coherently across "sandbox MCP available"
 *    vs. "live MCP removed" — it conflated states and gave contradictory advice.
 * 2. The bundled `stripe-register-products.ts` script works in both managed and
 *    legacy modes (reads STRIPE_SECRET_KEY from the alloc env, which is test or
 *    live depending on the sandbox state), so there is one product-registration
 *    path everywhere.
 *
 * The MCP client code and `loadStripeMcpTools` remain in the tree — flip the
 * flag back to `true` to re-enable. Keep the skill.md scrubbed of MCP references
 * while the flag is off so the LLM has no prior to invoke them.
 */

/**
 * Stripe skill lifecycle hooks.
 *
 * onLoad fires (1) at agent startup with no profile context — flag reads false,
 * loadStripeMcpTools returns {}, this is a safe no-op; and (2) on mid-
 * conversation skill load where the agent loop runs inside `runWithProfile` so
 * the flag is readable and `appId` is in context.
 *
 * While MCP_TOOLS_ENABLED is false, onLoad is an explicit no-op — we never
 * call loadStripeMcpTools so no MCP tools enter the registry. setup/status
 * are static and unaffected.
 */
export const hooks: SkillHooks = {
  onLoad: async ({ skillName, appId }) => {
    if (!MCP_TOOLS_ENABLED) {
      return;
    }
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
