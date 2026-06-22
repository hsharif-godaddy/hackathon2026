/**
 * Lazy, per-app Stripe MCP client.
 *
 * MCP is SANDBOX-ONLY. LLM-initiated writes to Stripe (create product, price,
 * etc.) go through mcp.stripe.com authenticated with STRIPE_MCP_KEY — the
 * ek_test_* restricted key from sandbox creation. At go-live, stripe-service
 * DELETES STRIPE_MCP_KEY from hosting (see buildLiveSecretsOps): live product
 * management happens directly in the Stripe Dashboard, not via the agent. We
 * deliberately do NOT swap in sk_live_* — that would expose a full live key to
 * the agent and drift if the merchant rotates it.
 *
 * STRIPE_MCP_KEY is delivered as a Protected secret so it lands in the agent
 * task's alloc config.json. STRIPE_SECRET_KEY is variant-scoped to preview and
 * publish tasks only and is NOT present in the agent's config — this is why we
 * read STRIPE_MCP_KEY, not STRIPE_SECRET_KEY, here.
 *
 * Lifecycle:
 *   - First call to loadStripeMcpTools(appId) reads STRIPE_MCP_KEY from
 *     the right config.json (see readStripeMcpKey), opens an MCP client,
 *     fetches tools, and caches the in-flight Promise keyed by MCP key value
 *     so concurrent callers share one createMCPClient() call. Cache entries
 *     expire after MCP_SESSION_TTL_MS — see TTL note below.
 *   - When STRIPE_MCP_KEY is absent (pre-provisioning OR post-go-live), returns
 *     {} so no MCP tools are registered.
 *   - Cache entry is cleared on error so the next skill activation can retry.
 *
 * Each tool's execute is also guarded (see guardToolWithCurrentKey) to refuse
 * if STRIPE_MCP_KEY changes or disappears AFTER registration — tool
 * registration is sticky, so deleting the key at go-live alone doesn't disable
 * tools already live in an in-flight conversation.
 *
 * TTL note: the 4-minute sliding-window TTL evicts stale sessions when
 * loadStripeMcpTools is re-invoked (new conversation, explicit load_skill).
 * It does NOT fix the case where a pinned skill's session expires mid-
 * conversation without a re-load — that requires lazy reconnect at the execute
 * layer and is tracked in AIROBUILD-2231.
 *
 * Tool naming: this module returns tools keyed by their RAW MCP names (e.g.
 * "create_product"). The skill-tool-manager applies the `stripe__` prefix
 * via buildSkillToolName when registerDynamicTools is called.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { createMCPClient } from '@ai-sdk/mcp';
import type { Tool } from 'ai';
import { logger } from '../../logging/index.js';
import { getNomadAllocConfig } from '../../utils/nomad-config.js';

const MCP_STRIPE_URL = 'https://mcp.stripe.com';

// MCP session TTL: Stripe's HTTP MCP sessions expire after a period of
// inactivity. Cached execute functions that reference a stale session fail
// silently ("no corresponding tool result"). Re-initialize after this window
// to ensure tool calls always run against a live session.
const MCP_SESSION_TTL_MS = 4 * 60 * 1000; // 4 minutes

type CacheEntry = {
  promise: Promise<Record<string, Tool>>;
  cachedAt: number;
  // close() is populated once createMCPClient resolves; no-op until then.
  // Called on TTL eviction and init errors to release the underlying transport.
  close: () => Promise<void>;
};

// Cache the in-flight Promise per MCP key. Keyed by the secret key value so
// a new sandbox (new key) gets its own entry. Entries older than
// MCP_SESSION_TTL_MS are evicted so the next call opens a fresh session.
// TTL resets on each cache hit (sliding window) so active sessions aren't
// torn down mid-conversation.
const cachedToolsByKey = new Map<string, CacheEntry>();

/**
 * Close and drop every cached entry whose key is not `keepKey`. Pass null to
 * evict all (e.g. after go-live, when the key was deleted). Prevents the prior
 * key's open MCP client from leaking when the key rotates or disappears.
 */
function evictStaleEntries(keepKey: string | null, appId?: string): void {
  for (const [key, entry] of cachedToolsByKey) {
    if (key === keepKey) {
      continue;
    }
    cachedToolsByKey.delete(key);
    entry.close().catch(() => {});
    logger.info('stripe_mcp_client.stale_entry_evicted', { appId });
  }
}

/**
 * Read STRIPE_MCP_KEY from the config.json that belongs to the calling app.
 *
 * Production (Nomad): NOMAD_ALLOC_DIR is set. STRIPE_MCP_KEY is a Protected
 * secret so hosting delivers it to the agent task's alloc config.json.
 * STRIPE_MCP_KEY arrives after process start (written by stripe-service after
 * provisioning), so we bypass getNomadAllocConfig()'s permanent memoization
 * and read the file fresh on every call.
 *
 * Local dev: NOMAD_ALLOC_DIR is unset. Each app has its own config.json under
 * APPS_BASE_DIR/<appId>/local/preview/config.json written by local-control-plane
 * when stripe-service pushes secrets via UpdateSecrets.
 */
function readStripeMcpKey(appId?: string): string | null {
  if (env.NOMAD_ALLOC_DIR) {
    // Read fresh every call — STRIPE_MCP_KEY arrives after process start so
    // the memoized getNomadAllocConfig() would return a stale snapshot.
    const allocConfigPath = join(env.NOMAD_ALLOC_DIR, 'config.json');
    if (!existsSync(allocConfigPath)) {
      return null;
    }
    try {
      const raw = readFileSync(allocConfigPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, { VALUE?: unknown }>;
      const v = config.STRIPE_MCP_KEY?.VALUE;
      return typeof v === 'string' && v ? v : null;
    } catch (err) {
      logger.error('stripe_mcp_client.config_read_failed', {
        path: allocConfigPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
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
 * Detect whether an error thrown by the MCP transport represents a 401/
 * unauthorized response from Stripe. We see this when the
 * `STRIPE_MCP_KEY` Stripe issued is still locally cached but Stripe has
 * server-side expired it — happens 7 days after a user claims the
 * sandbox without completing the live install (Stripe's documented
 * lifetime for the MCP key).
 *
 * The Vercel AI SDK / MCP transport surfaces the upstream HTTP error
 * shape inconsistently across versions, so we check two anchors:
 *   1. A numeric status (401 on the error object itself) — the most
 *      reliable signal when the transport preserves the HTTP status.
 *   2. A message substring, but ONLY when the status is also 401 or
 *      absent-from-the-object entirely — avoids false-positive matches
 *      on unrelated "unauthorized" messages from downstream operations
 *      (e.g. a Stripe API call that rejects because of insufficient
 *      permissions on the merchant account, not a bad key).
 *
 * We deliberately omit pure-substring-only matches ("unauthorized" with
 * no status signal) to avoid false positives. False positives steer the
 * user to a "claim again" flow that doesn't apply; false negatives just
 * let the original error propagate and surface to the user directly.
 */
function isMcpKeyExpiredError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { status?: number; statusCode?: number; message?: string };
  const numericStatus = e.status ?? e.statusCode;
  if (numericStatus === 401) return true;
  // Only use message substring when there's no numeric status to anchor on
  // (some transports omit the field entirely and put "401" in the message).
  if (numericStatus === undefined) {
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
    if (msg.startsWith('401') || msg.includes('401 unauthorized')) return true;
  }
  return false;
}

/**
 * Structured response a guarded tool returns when Stripe rejects the
 * MCP call as unauthorized. The skill prompt branches on the literal
 * `error: 'stripe_mcp_key_expired'` to drive the "ask the user to
 * complete claim+install" flow without retrying.
 */
const MCP_KEY_EXPIRED_RESPONSE = {
  error: 'stripe_mcp_key_expired',
  message:
    'Your Stripe authentication has expired. Stripe issues the MCP key for seven days after ' +
    'a sandbox is claimed; once that window passes, product/price tools stop working until the ' +
    'merchant finishes the claim+install flow and goes live. Tell the user to open their saved ' +
    "claim URL and complete the live setup, then they'll be able to manage products from the " +
    'Stripe Dashboard.',
} as const;

/**
 * Wrap an MCP tool's execute so it (a) re-checks the current
 * STRIPE_MCP_KEY in config before running and (b) translates 401-shaped
 * errors thrown by Stripe into a structured `stripe_mcp_key_expired`
 * response.
 *
 * Tool registration is sticky: once registered into a conversation, a
 * tool stays callable even after the key is deleted from config (e.g.
 * at go-live, when MCP becomes sandbox-only). The pre-flight key check
 * catches that case (`tool_blocked_stale_key`).
 *
 * The 401 catch covers a different case: the key is still locally
 * present but Stripe has server-side revoked it (typically 7 days
 * after claim). The user-facing distinction matters — "claim again"
 * vs "talk to the dashboard" — so the two branches return different
 * structured errors, and the skill prompt branches on the literal
 * `error` field.
 *
 * The pre-flight check is a single local config read (sub-ms,
 * page-cached) — no network call — so it adds negligible latency per
 * tool execution.
 */
function guardToolWithCurrentKey(
  toolName: string,
  toolDef: Tool,
  boundKey: string,
  appId?: string,
): Tool {
  const originalExecute = toolDef.execute;
  if (typeof originalExecute !== 'function') {
    return toolDef;
  }
  return {
    ...toolDef,
    execute: async (args: unknown, options: unknown) => {
      const currentKey = readStripeMcpKey(appId);
      if (currentKey !== boundKey) {
        logger.info('stripe_mcp_client.tool_blocked_stale_key', {
          appId,
          toolName,
          reason: currentKey ? 'key_rotated' : 'key_absent',
        });
        return {
          error: 'stripe_mcp_unavailable',
          message:
            'Stripe MCP tools are no longer available for this app. This usually means the ' +
            'account has gone live, where product and price management happens directly in ' +
            'the Stripe Dashboard (https://dashboard.stripe.com/products).',
        };
      }
      try {
        return await (originalExecute as (a: unknown, o: unknown) => Promise<unknown>)(args, options);
      } catch (err) {
        if (isMcpKeyExpiredError(err)) {
          logger.warn('stripe_mcp_client.tool_blocked_key_expired', {
            appId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          });
          // Drop the cached session — the bound key is now invalid
          // server-side, and a re-init wouldn't help (the key in
          // config is the same Stripe just rejected). The next skill
          // activation will see the same key, reach this path again,
          // and surface the same message. Recovery is the user
          // completing the claim+install flow Stripe is asking for.
          const cached = cachedToolsByKey.get(boundKey);
          if (cached) {
            cachedToolsByKey.delete(boundKey);
            cached.close().catch(() => {});
          }
          return MCP_KEY_EXPIRED_RESPONSE;
        }
        throw err;
      }
    },
  };
}

/**
 * Load Stripe MCP tools for the calling app. Returns an empty record when
 * STRIPE_MCP_KEY is not yet available (pre-provisioning, or pre-fire path
 * where appId is not known). Caches the tool list keyed by MCP key value —
 * re-fetch happens transparently if the key rotates (new sandbox or go-live).
 *
 * Returned keys are raw MCP tool names (e.g. "create_product"), without the
 * skill prefix. registerDynamicTools in SkillToolManager applies the prefix.
 * Each tool's execute is wrapped (see guardToolWithCurrentKey) to refuse if
 * STRIPE_MCP_KEY changes or disappears after registration.
 */
export async function loadStripeMcpTools(appId?: string): Promise<Record<string, Tool>> {
  const mcpKey = readStripeMcpKey(appId);

  // Close + drop any cached entries whose key is no longer current. After
  // go-live the key is deleted, so without this the prior ek_test_* entry's
  // open client would leak until process restart. keepKey=null evicts all.
  evictStaleEntries(mcpKey, appId);

  if (!mcpKey) {
    logger.info('stripe_mcp_client.no_key', {
      appId,
      message:
        'STRIPE_MCP_KEY not found in alloc/local config; Stripe MCP tools will not be available until the sandbox is provisioned',
    });
    return {};
  }

  const entry = cachedToolsByKey.get(mcpKey);
  if (entry && Date.now() - entry.cachedAt < MCP_SESSION_TTL_MS) {
    // Sliding window: reset the TTL on each hit so active sessions aren't
    // torn down mid-conversation.
    entry.cachedAt = Date.now();
    return entry.promise;
  }
  if (entry) {
    const ageMs = Date.now() - entry.cachedAt;
    logger.info('stripe_mcp_client.session_expired', { appId, ageMs });
    cachedToolsByKey.delete(mcpKey);
    entry.close().catch(() => {});
  }

  logger.info('stripe_mcp_client.init', { url: MCP_STRIPE_URL, appId });

  // closeRef lets the async IIFE hand back a close handle once the client
  // is created, so the cache entry can close it on TTL eviction or error.
  const closeRef: { fn: () => Promise<void> } = { fn: () => Promise.resolve() };

  const promise: Promise<Record<string, Tool>> = (async () => {
    try {
      const client = await createMCPClient({
        transport: {
          type: 'http',
          url: MCP_STRIPE_URL,
          headers: { Authorization: `Bearer ${mcpKey}` },
        },
      });
      closeRef.fn = () => client.close();

      const raw = await client.tools();
      const tools: Record<string, Tool> = {};
      for (const [name, toolDef] of Object.entries(raw)) {
        tools[name] = guardToolWithCurrentKey(name, toolDef, mcpKey, appId);
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
      // Close the transport (best-effort) and clear cache so the next skill
      // activation retries with a fresh client.
      closeRef.fn().catch(() => {});
      cachedToolsByKey.delete(mcpKey);
      return {};
    }
  })();

  cachedToolsByKey.set(mcpKey, { promise, cachedAt: Date.now(), close: () => closeRef.fn() });
  return promise;
}

/** Reset the per-key cache. For testing only. */
export function _resetStripeMcpClientCache(): void {
  cachedToolsByKey.clear();
}

/** Expose TTL for tests. */
export const _MCP_SESSION_TTL_MS = MCP_SESSION_TTL_MS;
