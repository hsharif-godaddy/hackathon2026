#!/usr/bin/env node
// Pre-warms Next.js dev compilation by GETting common routes in parallel.
// Hits the Gasket :8443 HTTPS proxy: auth redirects/401s are fine — the
// route chunk gets compiled either way.

const PORT = process.env.PREWARM_PORT || process.env.PORT || '8443';
const HOST = process.env.PREWARM_HOST || `https://local.gasket.dev-godaddy.com:${PORT}`;

// The Gasket dev proxy serves a locally-trusted (mkcert) cert that lives in the
// system keychain, but Node's fetch (undici) ships its own CA bundle and rejects
// it with UNABLE_TO_VERIFY_LEAF_SIGNATURE. undici ignores Node's https.Agent, so
// the reliable knob for this localhost-only dev script is the process-wide TLS
// flag. Scoped to this short-lived warmup process; never imported by app code.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// GET-ing a POST-only route returns 405, but Next.js compiles the route handler
// either way — the goal is compilation, not a successful response.
//
// Page paths use the bare (no-market) form: middleware rewrites `/foo` to
// `/<market>/foo`, so both forms compile the same chunk. `_warmup` stands in
// for any `[id]`/`[appId]`/`[name]` dynamic segment — the compiler keys on
// the route shape, not the param value.
const ROUTES = [
  // Pages
  '/',
  '/apps',
  '/create',
  '/develop/_warmup',
  '/develop/_warmup/context',
  '/explore',
  '/explore/_warmup',
  '/manage-plan',
  '/share/_warmup',

  // Auth, config, well-known
  '/.well-known/jwks.json',
  '/api/auth/agent-token',
  '/api/auth/logout',
  '/api/auth/token',
  '/api/auth/validate',
  '/api/config',
  '/api/health',
  '/api/i18n/package',

  // Apps
  '/api/apps/_warmup/deployments',
  '/api/apps/_warmup/dkim/offboard',
  '/api/apps/_warmup/dkim/onboard',
  '/api/apps/_warmup/dkim/status',
  '/api/apps/_warmup/dns-check-conflict',
  '/api/apps/_warmup/domain/check',
  '/api/apps/_warmup/download',
  '/api/apps/_warmup/email-signing/debug',
  '/api/apps/_warmup/events',
  '/api/apps/_warmup/exports',
  '/api/apps/_warmup/git/return',
  '/api/apps/_warmup/project-domain',
  '/api/apps/_warmup/publish-snapshots',
  '/api/apps/_warmup/purge-cache',
  '/api/apps/_warmup/share',
  '/api/apps/_warmup/subscription',
  '/api/apps/_warmup/transfer',
  '/api/apps/_warmup/transfer/cancel',
  '/api/apps/_warmup/transfer/validate',
  '/api/apps/_warmup/unpublish',

  // Sites
  '/api/sites',
  '/api/sites/_warmup',
  '/api/sites/_warmup/archive-restore',
  '/api/sites/_warmup/archive-status',
  '/api/sites/_warmup/deploy',
  '/api/sites/_warmup/domain-dns-ownership',
  '/api/sites/_warmup/domain-errors',
  '/api/sites/_warmup/domains',
  '/api/sites/_warmup/domains/job',
  '/api/sites/_warmup/image-status',
  '/api/sites/_warmup/reload-images',
  '/api/sites/_warmup/resume',
  '/api/sites/_warmup/variables',
  '/api/sites/quick-create',

  // Servers
  '/api/servers',
  '/api/servers/_warmup',

  // Subscriptions, entitlements, pricing, grants, token budget
  '/api/credits/grants',
  '/api/ecomm-subscription/auto-renew',
  '/api/ecomm-subscription/status',
  '/api/entitlements',
  '/api/entitlements/_warmup/update',
  '/api/pricing/offers',
  '/api/subscription-cache',
  '/api/subscription/exports/status',
  '/api/subscriptions',
  '/api/subscriptions/_warmup',
  '/api/subscriptions/_warmup/acknowledge',
  '/api/subscriptions/renew',
  '/api/token-budget/_warmup',

  // Database
  '/api/database/_warmup/tables',
  '/api/database/_warmup/tables/_warmup/data',
  '/api/database/_warmup/tables/_warmup/export',
  '/api/database/_warmup/tables/_warmup/rows',
  '/api/database/_warmup/tables/_warmup/schema',

  // Domains
  '/api/domains',
  '/api/domains/config',
  '/api/domains/isc-session',
  '/api/domains/search',

  // Develop, conversations, jobs, projects, venture, transfer
  '/api/conversations',
  '/api/develop/_warmup/context',
  '/api/jobs/_warmup',
  '/api/projects',
  '/api/transfer',
  '/api/venture',

  // Secrets, security
  '/api/secrets/_warmup/diff',
  '/api/secrets/_warmup/sync',
  '/api/secrets/_warmup/variants/_warmup',
  '/api/security-report/_warmup',

  // Analytics, logs, feedback, referrals, misc
  '/api/analytics/graphql',
  '/api/analytics/insights-feedback',
  '/api/cds-log',
  '/api/client-logs',
  '/api/crm/case',
  '/api/es-logs',
  '/api/eval-snapshots',
  '/api/feedback/s3-store',
  '/api/marketing/calendar',
  '/api/mcp/proxy',
  '/api/referral-link',
  '/api/referral/track',
  '/api/slack-webhook/feedback',
  '/api/testpilot',
  '/api/testpilot/_warmup',
];

const READY_TIMEOUT_MS = 10_000;
const READY_POLL_INTERVAL_MS = 1_000;
const READY_PROBE_TIMEOUT_MS = 5_000;
// Cold Next.js dev compilation of a route can take well over 10s the first time;
// this timeout must outlast a cold compile or the warmup aborts the very routes
// it is meant to warm. Routes are fetched in parallel, so a larger ceiling does
// not slow the common (already-compiled) case.
const ROUTE_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetchWithTimeout(`${HOST}/`, READY_PROBE_TIMEOUT_MS);
      return;
    } catch {
      // server not accepting connections yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`timed out waiting for ${HOST} after ${READY_TIMEOUT_MS}ms`);
}

async function warmRoute(path) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${HOST}${path}`, ROUTE_TIMEOUT_MS);
    const ms = Date.now() - start;
    console.log(`  ${String(res.status).padStart(3)}  ${String(ms).padStart(6)}ms  ${path}`);
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ERR  ${String(ms).padStart(6)}ms  ${path}  (${err.message})`);
  }
}

console.log(`[prewarm] waiting for ${HOST} ...`);
await waitForReady();
console.log(`[prewarm] up; warming ${ROUTES.length} routes`);
await Promise.all(ROUTES.map(warmRoute));
console.log('[prewarm] done');
