/**
 * Lazy, per-app Stripe MCP client.
 *
 * LLM-initiated writes to Stripe (create product, price, etc.) must go through
 * MCP using the restricted MCP key (`ek_test_*`), not the secret key. This
 * module fetches the MCP tool list for a given app's sandbox and caches it
 * keyed by MCP key.
 *
 * Lifecycle:
 *   - First call to loadStripeMcpTools(appId) reads the MCP key from the
 *     right config.json (see readStripeMcpKey below), opens an MCP client,
 *     fetches tools, and caches the in-flight Promise keyed by MCP key so
 *     concurrent callers (e.g. initialize() + a mid-conversation onLoad
 *     re-fire) share one createMCPClient() call.
 *   - Subsequent calls for the same key return the cached Promise.
 *   - When STRIPE_MCP_KEY is absent (pre-provisioning), returns {} so callers
 *     can register MCP tools only when the key is present. Cache entry is
 *     cleared on error so the next skill activation can retry.
 *
 * Tool naming: this module returns tools keyed by their RAW MCP names (e.g.
 * "products_create"). The skill-tool-manager applies the `stripe__` prefix
 * via buildSkillToolName when registerDynamicTools is called.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMCPClient } from '@ai-sdk/mcp';
import type { Tool } from 'ai';
import { logger } from '../../logging/index.js';
import { getNomadAllocConfig } from '../../utils/nomad-config.js';

const MCP_STRIPE_URL = 'https://mcp.stripe.com';

// Cache the in-flight Promise per MCP key. The key uniquely identifies the
// sandbox; storing the Promise (not the resolved value) lets concurrent
// callers share one createMCPClient() call rather than creating an orphaned
// client. A new sandbox mints a new key, which gets its own cache entry —
// existing entries are not invalidated.
const cachedToolsByKey = new Map<string, Promise<Record<string, Tool>>>();

/**
 * Read STRIPE_MCP_KEY from the config.json that belongs to the calling app.
 *
 * Production (Nomad): NOMAD_ALLOC_DIR is set; getNomadAllocConfig() reads
 * ${NOMAD_ALLOC_DIR}/config.json — the single per-alloc file Nomad templating
 * writes for this app's tasks. appId is unused because deployment topology is
 * one app per agent process.
 *
 * Local dev: NOMAD_ALLOC_DIR is unset (this env var is the codebase's
 * canonical "is this local?" signal — see publish.ts, git.ts, app.ts), so
 * getNomadAllocConfig() returns null. Each app has its own config.json under
 * APPS_BASE_DIR/<appId>/local/preview/config.json (written by
 * local-control-plane's syncSecretsToConfigFiles when stripe-service pushes
 * secrets via UpdateSecrets). We need appId to pick the right file because
 * one local agent process serves N apps.
 *
 * Mirrors the prod-vs-local config split in mysql-utils.ts:loadCredentialsFromApp.
 */
function readStripeMcpKey(appId?: string): string | null {
  const allocConfig = getNomadAllocConfig();
  if (allocConfig) {
    const v = allocConfig.STRIPE_MCP_KEY?.VALUE;
    return typeof v === 'string' && v ? v : null;
  }

  if (!appId) {
    return null;
  }
  // Defense-in-depth: appId is sourced from agent context (JWT-validated tenant
  // scope), but a path-traversal token would escape APPS_BASE_DIR if it slipped
  // through. Same guard as mysql-utils.ts:148.
  if (/[/\\]|\.\./.test(appId)) {
    return null;
  }
  const appsBaseDir = process.env.APPS_BASE_DIR || '/tmp/airo-app-builder';
  const configPath = join(appsBaseDir, appId, 'local', 'preview', 'config.json');
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, { VALUE?: unknown }>;
    const v = config.STRIPE_MCP_KEY?.VALUE;
    return typeof v === 'string' && v ? v : null;
  } catch (err) {
    logger.error('stripe_mcp_client.config_read_failed', {
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Load Stripe MCP tools for the calling app. Returns an empty record when
 * STRIPE_MCP_KEY is not yet available (pre-provisioning, or pre-fire path
 * where appId is not known). Caches the tool list keyed by MCP key — re-fetch
 * happens transparently if the key rotates (new sandbox).
 *
 * Returned keys are raw MCP tool names (e.g. "products_create"), without the
 * skill prefix. registerDynamicTools in SkillToolManager applies the prefix.
 */
export async function loadStripeMcpTools(appId?: string): Promise<Record<string, Tool>> {
  const mcpKey = readStripeMcpKey(appId);
  if (!mcpKey) {
    logger.info('stripe_mcp_client.no_key', {
      appId,
      message:
        'STRIPE_MCP_KEY not found in alloc/local config; Stripe MCP tools will not be available until sandbox is provisioned for this app',
    });
    return {};
  }

  const cached = cachedToolsByKey.get(mcpKey);
  if (cached) {
    return cached;
  }

  logger.info('stripe_mcp_client.init', { url: MCP_STRIPE_URL, appId });

  const promise: Promise<Record<string, Tool>> = (async () => {
    try {
      const client = await createMCPClient({
        transport: {
          type: 'http',
          url: MCP_STRIPE_URL,
          headers: { Authorization: `Bearer ${mcpKey}` },
        },
      });

      const raw = await client.tools();
      const tools: Record<string, Tool> = {};
      for (const [name, toolDef] of Object.entries(raw)) {
        tools[name] = toolDef;
      }

      logger.info('stripe_mcp_client.tools_loaded', {
        appId,
        toolCount: Object.keys(tools).length,
        tools: Object.keys(tools),
      });

      return tools;
    } catch (error) {
      logger.error('stripe_mcp_client.init_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Clear cache on error — allow retry on next skill activation.
      cachedToolsByKey.delete(mcpKey);
      return {};
    }
  })();

  cachedToolsByKey.set(mcpKey, promise);
  return promise;
}

/** Reset the per-key cache. For testing only. */
export function _resetStripeMcpClientCache(): void {
  cachedToolsByKey.clear();
}
