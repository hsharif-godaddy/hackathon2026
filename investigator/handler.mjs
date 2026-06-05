import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import gdAuth from 'gd-auth-client';

import { buildPrompt } from './prompt.mjs';
import { createEventEmitter } from './events.mjs';
import { decodeJwtExpMs, buildChildEnv } from './auth.mjs';
import { addCrmCaseNote } from './crm-casenote.mjs';
import { loadEvidenceCredentials } from './evidence-loader.mjs';
import { mintAgentToken } from './agent-jwt.mjs';
import { fetchAppZip, fetchConversations } from './agent-fetch.mjs';
import { writeMcpConfig, buildCustomerGraph, isGraphAvailable } from './graph-setup.mjs';
import { ensurePlatformGraph } from './platform-graph.mjs';
import { runVerifier } from './verifier.mjs';
import { extractToolActivities } from './activity.mjs';
import { buildLessonRecord, lessonKey } from './lessons.mjs';
// Re-export pure helpers so existing import paths in tests keep working.
export { decodeJwtExpMs, buildChildEnv };

/**
 * Parse the Loki cluster from an agent URL. Mirrors the debug-console
 * `extractClusterFromUrl` (debug-console/src/lib/investigate/evidence.ts).
 * Hosts follow `<appId>.<service>.<cluster>.<apex>` where the apex is
 * `airoapp.ai` in prod and `test-airoapp.ai` in dev/test — so the cluster is
 * the third-from-last label:
 *   prod  t1ilkvwm8o.preview.c24.airoapp.ai    -> c24
 *   test  t1ilkvwm8o.agent.c4.test-airoapp.ai  -> c4
 * Returns null for anything that doesn't match — the skill then degrades
 * rather than running an unbounded cross-cluster scan.
 *
 * @param {string} url
 * @returns {string | null}
 */
export function extractClusterFromUrl(url) {
  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    const parts = hostname.split('.');
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    // Accept the prod apex `airoapp.ai` and the dev/test apex
    // `<env>-airoapp.ai` (e.g. `test-airoapp.ai`).
    if (parts.length >= 4 && tld === 'ai' && (sld === 'airoapp' || sld.endsWith('-airoapp'))) {
      return parts[parts.length - 3] || null;
    }
    return null;
  } catch {
    return null;
  }
}

// Allowlist the agent host BEFORE we attach a minted bearer token to a fetch
// against it. agentUrl arrives in the invoke payload; validating it closes an
// SSRF / token-leak surface (a bad payload can't make us send a valid agents
// token to an attacker host) even though callers are IAM-trusted today.
// Accept only HTTPS on the prod apex `airoapp.ai` or a dev/test `<env>-airoapp.ai`
// apex — the same shape extractClusterFromUrl parses.
// Anchor the second-level label to OUR controlled env apexes only. A loose
// `endsWith('-airoapp')` would admit attacker-registrable look-alikes like
// `evil-airoapp.ai` (and `x.evil-airoapp.ai`) — which would then receive a
// minted agents-service bearer token. Only `airoapp`, `dev-airoapp`, and
// `test-airoapp` are real.
const ALLOWED_AGENT_SLD_RE = /^(?:dev-|test-)?airoapp$/;
export function isAllowedAgentHost(url) {
  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const u = new URL(normalized);
    if (u.protocol !== 'https:') return false;
    const parts = u.hostname.split('.');
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    return parts.length >= 3 && tld === 'ai' && ALLOWED_AGENT_SLD_RE.test(sld);
  } catch {
    return false;
  }
}

const { IamTokenClient } = gdAuth;

const REGION = process.env.AWS_REGION || 'us-west-2';
const STATE_BUCKET = process.env.STATE_BUCKET;
// `claude` is on PATH after `npm install -g @anthropic-ai/claude-code` in
// the Dockerfile. The actual install location under
// public.ecr.aws/lambda/nodejs isn't `/usr/lib/node_modules/...`, so don't
// hardcode the JS entrypoint path — spawn the `claude` command and let PATH
// resolve it.
const CLAUDE_BIN = 'claude';
const SKILL_NAME = 'airo-log-investigate';
const SKILL_SRC_DIR = `/opt/skills/${SKILL_NAME}`;
const CLAUDE_TEMPLATE_DIR = '/opt/claude-template';
const CLAUDE_HOME = '/tmp/.claude';
// The skill references scripts at `~/.claude/skills/airo-log-investigate/...`.
// Lambda filesystem is read-only outside /tmp, so we can't put files there at
// build time. We rehydrate state into /tmp/.claude at cold start and symlink
// the skill dir from the read-only /opt image into that writable tree so
// hard-coded paths resolve both for HOME=/tmp and for `~` expansion.
const SKILL_LINK_DIR = `${CLAUDE_HOME}/skills/${SKILL_NAME}`;
// Paired constant: app/src/lib/investigate/active-state.ts:ACTIVE_RUN_MAX_AGE_MS = 15*60_000.
// Lambda's hard cap is 15min; we self-kill at 14min so the terminal
// `status` flip in S3 lands before the BFF's stale-window cutoff. Bump
// both sides together if this ever changes.
const MAX_RUN_MS = 14 * 60_000;
const HEARTBEAT_MS = 10_000;
// Headroom reserved INSIDE MAX_RUN_MS for the fresh-context verifier
// (LLM-as-judge) spawn that runs after the main agent exits. The main
// agent's kill timer is shortened by this much so the judge fits within
// the 15-minute Lambda cap. The verifier is a strict soft-fail (see
// verifier.mjs): if it can't finish in this window it returns
// { ran: false } and the analysis ships unchanged.
const VERIFIER_BUDGET_MS = 3 * 60_000;

const s3 = new S3Client({ region: REGION });

// GoCode S2S JWT cache. The JWT is bound to this Lambda's execution role,
// so it's safe to reuse across warm-container invocations. Mirrors the
// caching pattern in packages/ai-lib/src/utils/s2s-auth.ts so a burst of
// Investigate clicks does not stampede SSO.
let cachedJwt = null;
let cachedJwtExpiresAt = 0;
let jwtRefreshInFlight = null;
// Reject cached tokens with < this much remaining so Claude CLI never gets
// a token that could expire mid-run. Investigations run up to ~14 minutes.
const JWT_MIN_LIFETIME_MS = 16 * 60 * 1000;
// Fail-fast bound on IamTokenClient.getToken(). Without this, an SSO hang
// would block the entire Lambda invocation up to the 15-minute cap and
// surface to the user as a generic timeout. 15s is well above p99 mint
// latency (typically < 2s) while short enough to convert a genuine outage
// into a visible "gocode auth failed" in the investigation state.
const JWT_MINT_TIMEOUT_MS = 15_000;

// Mint (or reuse) a GoCode S2S JWT. gd-auth-client IamTokenClient uses the
// Lambda's default credential chain (= execution role) to SigV4-sign a call
// to SSO's IAM-JWT API Gateway and returns a JWT whose `sub` claim is the
// Lambda's role ARN. That ARN must be pre-registered with GoCode S2S
// (see README "Deploy" section). The JWT is passed to Claude CLI as
// ANTHROPIC_AUTH_TOKEN (Bearer).
// `onBackgroundError` is invoked when gd-auth-client emits a
// `background_error` event during mint — the SSO call typically still
// succeeds via the secondary region, but operators want to know about
// the primary-region failure. The handler wires this to emitEvent so
// the SSE stream surfaces it as a non-fatal warning instead of leaving
// the signal in CloudWatch only.
async function mintGoCodeJwt(onBackgroundError) {
  const ssoHost = process.env.SSO_HOST;
  if (!ssoHost) throw new Error('SSO_HOST env var is required');

  const now = Date.now();
  if (cachedJwt && cachedJwtExpiresAt - now > JWT_MIN_LIFETIME_MS) {
    return cachedJwt;
  }
  if (jwtRefreshInFlight) return jwtRefreshInFlight;

  jwtRefreshInFlight = (async () => {
    try {
      const client = new IamTokenClient(ssoHost);
      client.once('background_error', (err) => {
        const detail = {
          ssoHost,
          message: err?.message,
          code: err?.code,
          name: err?.name,
        };
        console.error('[investigator] gocode s2s primary region failure', detail);
        if (typeof onBackgroundError === 'function') {
          try { onBackgroundError(detail); } catch { /* ignore listener throw */ }
        }
      });
      const jwt = await Promise.race([
        client.getToken(),
        new Promise((_resolve, reject) => setTimeout(
          () => reject(new Error(`IamTokenClient.getToken timed out after ${JWT_MINT_TIMEOUT_MS}ms`)),
          JWT_MINT_TIMEOUT_MS,
        ).unref()),
      ]);
      const expiresAt = decodeJwtExpMs(jwt);
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= JWT_MIN_LIFETIME_MS) {
        // Refuse a token that could expire mid-investigation. Returning
        // it anyway would defeat the JWT_MIN_LIFETIME_MS guarantee the
        // cache is built around: Claude could spend 14 minutes on a
        // search and have the proxy 401 the final synthesis call. The
        // handler-side catch surfaces this as `gocode auth failed`,
        // which is the right outcome — the user retries and the next
        // invocation mints a fresh token.
        cachedJwt = null;
        cachedJwtExpiresAt = 0;
        throw new Error(
          `GoCode S2S returned short-lived JWT (remaining ${remainingMs}ms < min ${JWT_MIN_LIFETIME_MS}ms)`,
        );
      }
      cachedJwt = jwt;
      cachedJwtExpiresAt = expiresAt;
      return jwt;
    } finally {
      jwtRefreshInFlight = null;
    }
  })();

  return jwtRefreshInFlight;
}

let bootstrapped = false;

async function bootstrap() {
  if (bootstrapped) return;

  // Rehydrate Claude config into writable /tmp — Lambda's root filesystem is
  // read-only except for /tmp, but Claude CLI expects to be able to write
  // things like plugin caches and the skill allowlist under $HOME/.claude.
  await fs.mkdir(CLAUDE_HOME, { recursive: true });
  await fs.cp(CLAUDE_TEMPLATE_DIR, CLAUDE_HOME, { recursive: true });
  process.env.HOME = '/tmp';
  process.env.CLAUDE_CONFIG_DIR = CLAUDE_HOME;

  // Phase md files + scripts reference the skill as
  //   ~/.claude/skills/airo-log-investigate/search_frontend_logs.py
  // Symlink the read-only /opt image copy into the writable /tmp tree so the
  // hard-coded path works without patching the skill.
  try {
    await fs.mkdir(`${CLAUDE_HOME}/skills`, { recursive: true });
    const existing = await fs.lstat(SKILL_LINK_DIR).catch(() => null);
    if (!existing) {
      await fs.symlink(SKILL_SRC_DIR, SKILL_LINK_DIR, 'dir');
    }
  } catch (err) {
    // Lambda reuses warm containers; a pre-existing symlink is fine.
    if (err && err.code !== 'EEXIST') throw err;
  }

  // Per-invocation secrets (gocodeApiKey on the legacy path; the Loki/ES
  // evidence keys for direct mode) are set on process.env inside the handler
  // and cleared in its finally block so they never leak into the next
  // warm-container invocation.
  // The S2S JWT, by contrast, IS reused across warm invocations on
  // purpose — it is bound to the Lambda execution role, so caching it
  // avoids stampeding SSO on bursts of Investigate clicks. See
  // mintGoCodeJwt for the cache + min-lifetime guard.
  // ANTHROPIC_BASE_URL is a non-secret constant set as a plain Lambda env var.
  bootstrapped = true;
}

async function readJson(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: STATE_BUCKET, Key: key }));
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

async function putJson(key, obj) {
  await s3.send(new PutObjectCommand({
    Bucket: STATE_BUCKET,
    Key: key,
    Body: JSON.stringify(obj, null, 2),
    ContentType: 'application/json',
  }));
}

async function putText(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: STATE_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || 'text/plain',
  }));
}

// Cached active state.json for the current invocation. Eliminates the
// per-heartbeat S3 GET — a 14-minute run otherwise pays ~84 GET round-
// trips, all just to merge a tiny progress patch into a doc the Lambda
// itself last wrote. Concurrency model: console acquireLock writes
// state.json before invoking; Lambda is the sole writer thereafter, so
// after the very first read the cache is authoritative. Reset to null at
// the top of `handler()` so warm-container reuse never bleeds state from
// a previous (customer, app) invocation.
let cachedState = null;
let cachedStateKey = null;

function resetMergeStateCache() {
  cachedState = null;
  cachedStateKey = null;
}

async function loadInitialState(stateKey) {
  // Single round-trip per invocation. NoSuchKey is normal on the BFF
  // feedback path (no acquireLock) and on the very first console run for
  // a (customer, app); any other error is abnormal and worth logging but
  // not throwing — we fall through with an empty base document so the
  // first PUT lands.
  try {
    cachedState = await readJson(stateKey);
  } catch (err) {
    const is404 =
      err?.name === 'NoSuchKey' ||
      err?.name === 'NotFound' ||
      err?.$metadata?.httpStatusCode === 404;
    if (!is404) {
      console.error('[investigator] loadInitialState read failed', { stateKey, err });
    }
    cachedState = {};
  }
  cachedStateKey = stateKey;
}

async function mergeState(stateKey, patch) {
  // This is intentionally last-writer-wins. Heartbeats may race each other, but
  // they only update progress fields. The `finalized` guard in handler()
  // prevents the dangerous case where a late heartbeat overwrites terminal
  // state. If BFF vs Lambda write collisions become observable, carry the
  // S3 ETag from readJson and put with IfMatch instead of broadening the
  // lock model prematurely.
  if (cachedStateKey !== stateKey) {
    // Defensive: if the caller hands us a different stateKey mid-
    // invocation (shouldn't happen — handler binds it once), reset.
    await loadInitialState(stateKey);
  } else if (cachedState === null) {
    await loadInitialState(stateKey);
  }
  cachedState = { ...cachedState, ...patch, updatedAt: new Date().toISOString() };
  await putJson(stateKey, cachedState);
  return cachedState;
}

/**
 * Extracts the first non-heading paragraph from a markdown report
 * to use as a brief summary in the CRM caseNote.
 */
function deriveSummary(md) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    return line.slice(0, 240);
  }
  return md.slice(0, 240).replace(/\s+/g, ' ').trim();
}

/**
 * Encode customerId + appId + tab as a single base64url JSON blob.
 * Mirrors `app/src/lib/feedback/investigate-url.ts:encodeInvestigateCtx`
 * — keep the keys ('c', 'a', 't') and shape in lockstep across both sites.
 *
 * Why a single param: CMAPI HTML-escapes note bodies on storage, turning
 * every `&` in a multi-param URL into `&amp;`. Support agents who copy-
 * paste the link from CRM get the literal `&amp;` text — Chrome doesn't
 * decode HTML entities from the address bar — and click-through routes
 * to the wrong page. base64url has no characters that need URL or HTML
 * escaping, so the URL survives the round-trip intact.
 */
function encodeInvestigateCtx(customerId, appId) {
  const payload = JSON.stringify({ c: customerId, a: appId, t: 'investigate' });
  return Buffer.from(payload, 'utf-8').toString('base64url');
}

async function maybeAddCrmCaseNote({ status, crmCaseId, investigationId, appId, customerId, reportSummary }) {
  if (status !== 'completed') return;
  if (!crmCaseId) return;
  const baseUrl = process.env.DEBUG_CONSOLE_BASE_URL;
  if (!baseUrl) {
    console.warn('[investigator] crm.casenote.skipped: DEBUG_CONSOLE_BASE_URL not set', { investigationId });
    return;
  }
  // Single-param URL — see `encodeInvestigateCtx` doc above. The console
  // (`debug-console/src/pages/Dashboard.tsx`) decodes `?ctx=` back into
  // customerId + appId + activeTab on mount and routes accordingly.
  if (!customerId || !appId) {
    console.warn('[investigator] crm.casenote.skipped: missing customerId or appId', {
      investigationId, hasCustomerId: !!customerId, hasAppId: !!appId,
    });
    return;
  }
  const ctx = encodeInvestigateCtx(customerId, appId);
  const reportUrl = `${baseUrl.replace(/\/$/, '')}/?ctx=${ctx}`;
  try {
    await addCrmCaseNote({
      caseId: crmCaseId,
      summary: (reportSummary || 'investigation complete').slice(0, 600),
      reportUrl,
    });
    console.log('[investigator] crm.casenote.success', { investigationId, caseId: crmCaseId });
  } catch (err) {
    console.error('[investigator] crm.casenote.failed', {
      investigationId,
      caseId: crmCaseId,
      error: err && err.message,
    });
  }
}

async function snapshotToHistory(stateKey, historyPrefix, investigationId) {
  await s3.send(new CopyObjectCommand({
    Bucket: STATE_BUCKET,
    CopySource: `${STATE_BUCKET}/${stateKey}`,
    Key: `${historyPrefix}${investigationId}/state.json`,
    ContentType: 'application/json',
    MetadataDirective: 'REPLACE',
  }));
}

function spawnClaude(prompt, logStream, mcpConfigPath) {
  const args = [
    '-p', prompt,
    '--model', 'claude-sonnet-4-6',
    '--output-format=stream-json',
    '--verbose',
    // Bumped from 35 → 60 after observed `error_max_turns` exits during
    // phase-1 analysis. Each Python helper Claude writes that crashes
    // (e.g. `sorted(list_of_dicts)` without a key) eats 2-3 turns
    // before recovery. 60 gives realistic headroom while still bounded
    // by MAX_RUN_MS = 14 min. Main bumped to 50 in parallel; we keep
    // 60 because the documented incident requires it.
    '--max-turns', '60',
    '--dangerously-skip-permissions',
  ];
  // Hand the Claude CLI the stdio MCP config so the skill can reach the
  // code-review-graph server (platform graph always; customer graph when the
  // runtime build succeeded). The CLI passes the config's `env` block
  // (PYTHONPATH/LD_LIBRARY_PATH) to the spawned python server — that's why
  // buildChildEnv() deliberately does NOT carry them: the MCP server env is
  // separate from the claude process env.
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }
  const child = spawn(CLAUDE_BIN, args, {
    env: buildChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  return child;
}

function parsePhaseFromLine(line) {
  const m = line.match(/phase-\d+-[a-z0-9-]+/i);
  return m ? m[0].toLowerCase() : null;
}

// Best-effort state release. Used from the credential-validation early
// exits where we want to mark the investigation failed even if S3 is
// misbehaving — the alternative is leaving the BFF's acquireLock row at
// status: 'pending' until the 60s zombie timeout reclaims it. Failure
// here only means the user has to wait that timeout; don't escape.
async function tryReleaseLockAsFailed(stateKey, patch) {
  try {
    await mergeState(stateKey, patch);
  } catch (err) {
    console.error('[investigator] failed to mark state as failed', {
      stateKey, patch, err,
    });
  }
}

export async function handler(event) {
  const started = Date.now();
  // Lambda reuses warm containers, so any module-scope state from a
  // previous invocation must be cleared before the first read of this
  // run's state.json — otherwise we'd merge into the previous (customer,
  // app)'s document.
  resetMergeStateCache();
  const {
    investigationId,
    appId,
    customerId,
    feedback,
    timeWindow,
    stateKey,
    historyPrefix,
    resultKey,
    tracePrefix,
    eventsPrefix,
    gocodeApiKey,
    agentUrl,
    source,
  } = event;

  if (!investigationId || !appId || !stateKey) {
    throw new Error('investigationId, appId, stateKey are required');
  }

  const emitEvent = createEventEmitter({
    s3,
    bucket: STATE_BUCKET,
    eventsPrefix,
    investigationId,
  });

  await emitEvent('investigation.started', {
    appId,
    customerId,
    input: { feedback, timeWindow },
    lambdaRequestId: process.env.AWS_LAMBDA_REQUEST_ID || null,
  });

  // Preserve console-acquireLock's startedAt when present; for BFF-invoked
  // feedback-source runs the active state.json may be missing or stale, so
  // we stamp a fresh ISO timestamp. The BFF's active-state.ts uses startedAt
  // as a fallback staleness reference when heartbeatAt isn't yet written, so
  // it must be set on EVERY first state-write or the lock check returns
  // "no running investigation" for genuinely-running Lambdas.
  //
  // Force the one S3 GET that bootstraps the mergeState cache to happen
  // here, then read startedAt off the cached doc — saves the duplicate
  // GET the previous revision did before mergeState's own read.
  await loadInitialState(stateKey);
  const preexistingStartedAt =
    typeof cachedState?.startedAt === 'string' && cachedState.startedAt
      ? cachedState.startedAt
      : null;

  try {
    await mergeState(stateKey, {
      // Stamp investigationId so feedback-source invocations (which bypass
      // acquireLock) overwrite any stale investigationId left by a previous run.
      investigationId,
      appId,
      customerId,
      status: 'running',
      phase: 'bootstrap',
      lastEvent: 'lambda handler entered',
      startedAt: preexistingStartedAt ?? new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      lambdaRequestId: process.env.AWS_LAMBDA_REQUEST_ID || null,
    });
  } catch (err) {
    // Keep going so a transient first S3 write failure does not prevent the
    // later, more useful phase updates from landing.
    console.error('[investigator] initial state write failed', { stateKey, err });
  }

  try {
    await bootstrap();
  } catch (err) {
    console.error('[investigator] bootstrap failed', { stateKey, err });
    const errMsg = err instanceof Error ? err.message : String(err);
    await emitEvent('investigation.failed', { phase: 'bootstrap', error: errMsg });
    await tryReleaseLockAsFailed(stateKey, {
      status: 'failed',
      phase: 'bootstrap',
      lastEvent: 'lambda bootstrap failed',
      heartbeatAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      lambdaRequestId: process.env.AWS_LAMBDA_REQUEST_ID || null,
      error: errMsg,
    });
    return { statusCode: 500, body: 'bootstrap failed' };
  }

  // Per-invocation credential: GoCode auth, used by Claude CLI as
  // ANTHROPIC_AUTH_TOKEN. Depends on GOCODE_USE_S2S_AUTH:
  //   'true'  → mint IAM JWT via gd-auth-client using the Lambda execution
  //             role directly (no STS assume; ignores gocodeApiKey from
  //             payload). Role must be registered with GoCode S2S — see
  //             README.
  //   'false' → use gocodeApiKey from invoke payload (legacy; kept for fast
  //             manual rollback via Lambda console env var flip).
  // It lives in process env for this invocation only and is cleared in a
  // finally block below — Lambda reuses warm containers, so an exception
  // escaping before cleanup could leak creds into the next invocation.
  //
  // Both triggers (console click + BFF feedback fan-out) now run the same
  // direct-evidence path: no per-user session token and no console proxy.
  // Both rely on the Lambda's IAM identity (S2S JWT for GoCode; Secrets
  // Manager for the Loki/ES evidence keys loaded below) for all downstream
  // calls.
  const s2sEnabled = process.env.GOCODE_USE_S2S_AUTH === 'true';
  let gocodeAuthToken;
  if (s2sEnabled) {
    try {
      gocodeAuthToken = await mintGoCodeJwt((detail) => {
        // Fire-and-forget: don't let SSE delivery latency block the mint
        // (primary failed; secondary region is what we're awaiting).
        emitEvent('investigation.warning', {
          source: 'gocode-s2s',
          reason: 'primary-region-failure',
          ...detail,
        }).catch(() => {});
      });
    } catch (err) {
      console.error('[investigator] gocode s2s jwt mint failed', {
        investigationId,
        stateKey,
        ssoHost: process.env.SSO_HOST,
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        err,
      });
      await emitEvent('investigation.failed', {
        phase: 'credentials',
        error: err instanceof Error ? err.message : String(err),
      });
      await tryReleaseLockAsFailed(stateKey, {
        status: 'failed',
        lastEvent: 'failed to mint gocode s2s jwt',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      return { statusCode: 500, body: 'gocode auth failed' };
    }
  } else {
    // Legacy rollback path: caller forwards a gocodeApiKey. This branch is
    // only reached when an operator flips GOCODE_USE_S2S_AUTH='false' in the
    // Lambda console. Neither trigger forwards a gocodeApiKey anymore (both
    // rely on the S2S JWT minted above), so in practice this 400s generically
    // when the env var is flipped — which is the intended "rollback needs a
    // key" signal, not a per-source rejection.
    if (!gocodeApiKey || typeof gocodeApiKey !== 'string') {
      await emitEvent('investigation.failed', { phase: 'credentials', error: 'gocodeApiKey missing' });
      await tryReleaseLockAsFailed(stateKey, {
        status: 'failed',
        lastEvent: 'missing gocode api key from caller',
        completedAt: new Date().toISOString(),
        error: 'gocodeApiKey missing from invoke payload',
      });
      return { statusCode: 400, body: 'gocodeApiKey required' };
    }
    gocodeAuthToken = gocodeApiKey;
  }

  // Counter + relog helper for emitEvent failures (review S-13). Hoisted
  // here so the evidence-credentials degradation alarm below — the most
  // consequential event to lose silently — can use it. A misconfigured
  // `events/` prefix or transient S3 outage would otherwise swallow every
  // phase-marker / heartbeat / warning write silently. We log on the 1st,
  // 10th, 100th, ... failure so a persistent outage shows up as a
  // recurring CloudWatch signature without flooding logs on a steady-
  // state miss.
  let emitEventFailures = 0;
  const EMIT_RELOG_EVERY = 10;
  function logEmitFailure(eventName, err) {
    emitEventFailures += 1;
    if (
      emitEventFailures === 1 ||
      emitEventFailures % EMIT_RELOG_EVERY === 0
    ) {
      console.error('[investigator] emitEvent failed', {
        eventName,
        occurrence: emitEventFailures,
        err: err && err.message ? err.message : String(err),
      });
    }
  }

  // Guards the catch below from clobbering a good terminal verdict: set true
  // once the terminal mergeState lands, so a future post-terminal throw (a new
  // CRM/history/cleanup callee) can't flip a completed/killed run to failed.
  let terminalRecorded = false;

  try {
    // Both triggers (console click + BFF feedback fan-out) run the same
    // direct-evidence path: bypass the debug-console proxy entirely — load
    // evidence credentials from Secrets Manager and set them as env vars so
    // the Python skill queries Loki / ES directly via INVESTIGATION_DIRECT_MODE.
    // This MUST happen before claude spawns so the skill sees direct mode.
    //
    // Failure semantics are NEGATIVE-ONLY by design: the success path
    // doesn't write `evidenceCredsLoaded: true` to state.json. A dashboard
    // polling /api/investigate/{id}/status distinguishes
    //   - "partial evidence run"  → state has `evidenceCredsLoaded: false`
    //   - "fully healthy run"     → field is absent
    //
    // PERF: start the independent slow I/O (platform-graph S3 fetch + agent
    // token mint) BEFORE awaiting evidence creds, so they overlap the rest of
    // setup instead of running serially. Both are awaited at their existing
    // call sites below; each resolves to a tagged result and NEVER throws
    // (note the .catch), so every side-effecting handler (env / emitEvent /
    // mergeState) still runs sequentially in the main flow — the last-writer-
    // wins mergeState therefore never races.
    const platformGraphRootP = ensurePlatformGraph({ client: s3 }).catch(() => null);
    // Only mint (and later attach) a token when the agent host is allowlisted —
    // never send a valid agents token to an unexpected host from the payload.
    const agentHostAllowed = Boolean(agentUrl) && isAllowedAgentHost(agentUrl);
    const agentTokenP = agentHostAllowed
      ? mintAgentToken({ appId, canDownload: true })
          .then((minted) => ({ ok: true, token: minted.token }))
          .catch((err) => ({ ok: false, err }))
      : Promise.resolve(null);

    try {
      const creds = await loadEvidenceCredentials();
      process.env.LOKI_API_KEY = creds.lokiApiKey;
      process.env.AIRO_BUILDER_ES_API_KEY = creds.airoBuilderEsApiKey;
      process.env.INVESTIGATION_DIRECT_MODE = 'true';
      console.log('[investigator] evidence.credentials.loaded', { investigationId });
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      console.error('[investigator] evidence.credentials.failed — investigation may be partial', {
        investigationId,
        error: errorMessage,
      });
      // Surface as a structured event so the SSE stream + dashboard see
      // the degradation. Use the same logEmitFailure helper as phase
      // markers + heartbeats — this is the most consequential event to
      // lose silently (the alarm itself), so a misconfigured events/
      // prefix MUST surface in CloudWatch.
      emitEvent('investigation.warning', {
        source: 'evidence-credentials',
        message: 'Evidence credential load failed; skill will run without direct mode',
        error: errorMessage,
      }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
      // Stamp the state document so a dashboard polling /status can
      // distinguish "completed with partial evidence" from a fully
      // healthy run without correlating CloudWatch logs.
      await mergeState(stateKey, {
        evidenceCredsLoaded: false,
        evidenceCredsError: errorMessage.slice(0, 240),
      }).catch((stateErr) => {
        console.error('[investigator] mergeState evidenceCredsLoaded=false failed', {
          stateKey, err: stateErr,
        });
      });
      // Continue without direct mode; skill will fail evidence collection
      // gracefully and still run the analysis on whatever it has.
    }
    process.env.ANTHROPIC_AUTH_TOKEN = gocodeAuthToken;

    const workDir = `/tmp/${investigationId}`;
    await fs.mkdir(workDir, { recursive: true });
    process.env.REPORT_DIR = workDir;

    // Fetch app code + conversation history from the agents service so the
    // skill can correlate logs against the actual source + customer/agent
    // dialogue. This is strictly SOFT-DEGRADE: any failure (auth, network,
    // unzip) emits a warning + state note and continues with a logs-only
    // investigation — it must NEVER hard-fail the run. Mirrors the
    // evidence-credentials degradation pattern above.
    // Track evidence coverage so a degraded run can't emit a confident verdict.
    let appCodeAvailable = false;
    let conversationsAvailable = false;

    if (agentHostAllowed) {
      // Derive the Loki cluster from the agent URL and expose it to the skill.
      // cluster is a mandatory label for the structured-metadata Loki queries —
      // without it the data-plane selector scans ~386 GiB/hr (the skill
      // degrades to an incomplete result rather than run that). Empty string
      // when unparseable so the skill sees an explicit "unset".
      process.env.LOKI_CLUSTER = extractClusterFromUrl(agentUrl) ?? '';

      let agentToken = null;
      // Already in flight since setup start — await the tagged result here so
      // the mint overlapped creds loading instead of running after it.
      const tokenResult = await agentTokenP;
      if (tokenResult && tokenResult.ok) {
        agentToken = tokenResult.token;
      } else if (tokenResult && !tokenResult.ok) {
        const err = tokenResult.err;
        const errorMessage = err && err.message ? err.message : String(err);
        console.error('[investigator] agent.token.mint.failed — code+convo context unavailable', {
          investigationId,
          error: errorMessage,
        });
        emitEvent('investigation.warning', {
          source: 'agent-auth',
          message: 'Agent token mint failed; investigation will run without code/conversation context',
          error: errorMessage,
        }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
      }

      if (agentToken) {
        // PERF: start the app-zip download and the conversation fetch together
        // so they overlap on the wire; await zip first (handle + build graph),
        // then convos below. Both are pure result objects — no side effects
        // inside — so the handling stays sequential.
        const codeResP = fetchAppZip({ agentUrl, appId, token: agentToken, destDir: workDir });
        const convoResP = fetchConversations({ agentUrl, appId, token: agentToken });
        // App code → unzipped under workDir. On success expose the dir to the
        // skill via APP_CODE_DIR; on failure warn + note and continue.
        const codeRes = await codeResP;
        if (codeRes.ok) {
          process.env.APP_CODE_DIR = codeRes.dir;
          appCodeAvailable = true;
          console.log('[investigator] agent.code.fetched', { investigationId, dir: codeRes.dir });

          // Build the customer's code graph from the just-unzipped source so
          // the skill can query it via the code-review-graph MCP. SOFT-DEGRADE:
          // on failure we warn + continue — the agent still has Read/Grep and
          // (when present) the baked platform graph. Gated on graphAvailable:
          // if the CRG python deps aren't in the image there's nothing to build
          // and nothing for the MCP to serve, so skip silently rather than burn
          // the build budget on a guaranteed-failing invocation.
          if (await isGraphAvailable()) {
            const graphRes = await buildCustomerGraph(codeRes.dir);
            if (!graphRes.ok) {
              console.error('[investigator] customer.graph.build.failed', {
                investigationId,
                dir: codeRes.dir,
                detail: graphRes.detail,
              });
              emitEvent('investigation.warning', {
                source: 'customer-graph',
                message: 'Customer code graph build failed; skill will rely on the platform graph + Read/Grep',
                error: graphRes.detail,
              }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
            } else {
              console.log('[investigator] customer.graph.built', { investigationId, dir: codeRes.dir });
            }
          } else {
            console.log('[investigator] customer.graph.skipped — CRG tooling not present in image', { investigationId });
          }
        } else {
          console.error('[investigator] agent.code.fetch.failed', {
            investigationId,
            error: codeRes.error,
          });
          emitEvent('investigation.warning', {
            source: 'app-code',
            message: 'App code fetch failed; investigation will run without source context',
            error: codeRes.error,
          }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
          await mergeState(stateKey, {
            appCodeFetched: false,
            appCodeError: String(codeRes.error).slice(0, 240),
          }).catch((stateErr) => {
            console.error('[investigator] mergeState appCodeFetched=false failed', {
              stateKey, err: stateErr,
            });
          });
        }

        // Conversations → persisted to conversations.json. fetchConversations
        // returns an array on ok (it unwraps the common {conversations:[...]}
        // wrapper and fails on unusable shapes); the Array.isArray guard here
        // is belt-and-suspenders so a non-array can never be written or counted
        // as coverage (which would wrongly skip the degraded-coverage cap).
        const convoRes = await convoResP;
        if (convoRes.ok && Array.isArray(convoRes.conversations)) {
          const conversationsPath = path.join(workDir, 'conversations.json');
          try {
            await fs.writeFile(conversationsPath, JSON.stringify(convoRes.conversations));
            process.env.CONVERSATIONS_PATH = conversationsPath;
            conversationsAvailable = true;
            console.log('[investigator] agent.conversations.fetched', { investigationId });
          } catch (err) {
            const errorMessage = err && err.message ? err.message : String(err);
            console.error('[investigator] agent.conversations.write.failed', {
              investigationId,
              error: errorMessage,
            });
            emitEvent('investigation.warning', {
              source: 'conversations',
              message: 'Conversation history could not be persisted; continuing without it',
              error: errorMessage,
            }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
          }
        } else {
          console.error('[investigator] agent.conversations.fetch.failed', {
            investigationId,
            error: convoRes.error,
          });
          emitEvent('investigation.warning', {
            source: 'conversations',
            message: 'Conversation history fetch failed; continuing without it',
            error: convoRes.error,
          }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
          await mergeState(stateKey, {
            conversationsFetched: false,
            conversationsError: String(convoRes.error).slice(0, 240),
          }).catch((stateErr) => {
            console.error('[investigator] mergeState conversationsFetched=false failed', {
              stateKey, err: stateErr,
            });
          });
        }
      }
    } else {
      // Either no agentUrl, or its host isn't allowlisted (SSRF guard). Either
      // way the skill runs logs-only; surface a single warning so the dashboard
      // distinguishes a deliberately logs-only run from a silent context gap.
      if (agentUrl) {
        console.error('[investigator] agent.host.rejected — agentUrl host not allowlisted', {
          investigationId,
          appId,
        });
      }
      emitEvent('investigation.warning', {
        source: 'agent-url',
        message: agentUrl
          ? 'agentUrl host not allowlisted; code+conversation context unavailable; logs-only'
          : 'No agentUrl provided; code+conversation context unavailable; logs-only',
      }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
    }

    const traceLocalPath = path.join(workDir, 'trace.jsonl');
    const logStream = createWriteStream(traceLocalPath);

    await mergeState(stateKey, {
      status: 'running',
      phase: 'claude-analysis',
      lastEvent: 'container warm, launching claude search workflow',
      heartbeatAt: new Date().toISOString(),
      lambdaRequestId: process.env.AWS_LAMBDA_REQUEST_ID || null,
    });
    await emitEvent('phase.started', { phase: 'claude-analysis' });

    // Write the MCP config ONLY when the CRG python tooling is actually present
    // in the image. If a build shipped without /opt/py-packages/code_review_graph
    // (or the deps install was skipped), handing the Claude CLI an --mcp-config
    // that points at a server it can't start surfaces as a noisy MCP connection
    // failure and can disrupt the run. Gate it: a missing/failed graph then can
    // NEVER break an investigation — the agent falls back to Read/Grep + the log
    // skill. When present, the config exposes the baked platform graph (always)
    // plus the customer graph (when the build above succeeded).
    // Fetch the platform code-review-graph from S3 (rebuilt twice a day by
    // .github/workflows/refresh-platform-graph.yml and uploaded to
    // `platform-graph/graph.db.gz`). SOFT-FAIL: a missing object or any S3 error
    // returns null — the skill then queries only the customer graph + Read/Grep,
    // so platform-graph absence never breaks a run. PLATFORM_GRAPH_ROOT is the
    // repo root the skill passes to the code-review-graph MCP tools; '' means
    // "unset" (the prompt only references it when set). It must be in the
    // buildChildEnv allowlist (auth.mjs) or the child CLI never sees it.
    // Already in flight since setup start — overlaps creds/token/zip/convos.
    const platformGraphRoot = await platformGraphRootP;
    process.env.PLATFORM_GRAPH_ROOT = platformGraphRoot ?? '';
    if (platformGraphRoot) {
      console.log('[investigator] platform.graph.loaded', { investigationId, root: platformGraphRoot });
    } else {
      emitEvent('investigation.warning', {
        source: 'platform-graph',
        message: 'Platform code graph unavailable; skill will rely on the customer graph + Read/Grep',
      }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));
    }

    let mcpConfigPath = null;
    if (await isGraphAvailable()) {
      mcpConfigPath = await writeMcpConfig(path.join(workDir, 'mcp.json'));
    } else {
      console.log('[investigator] mcp.config.skipped — CRG tooling not present in image', { investigationId });
    }

    const prompt = buildPrompt({
      appId,
      feedback,
      timeWindow,
      hasAppCode: appCodeAvailable,
      hasConversations: conversationsAvailable,
    });
    const child = spawnClaude(prompt, logStream, mcpConfigPath);

    let latestPhase = 'claude-analysis';
    let latestEvent = 'claude searching telemetry';

    // (logEmitFailure + emitEventFailures are hoisted above the try
    // block so the evidence-credentials degradation emit can share the
    // same counter. See review S-13 follow-up note above.)

    // Tap stdout for phase markers + per-action activity. The pipe (spawnClaude)
    // already writes the raw stream-json to the trace file; this tap only reads.
    //
    // stream-json emits one JSON object per line, but a `data` chunk can split a
    // line across two events — so we buffer and only process COMPLETE lines
    // (split on \n, keep the remainder). Without this, extractToolActivities'
    // JSON.parse would throw on the partial line and silently drop that tool
    // call. Phase parsing (substring match) was tolerant of splits; activity
    // parsing is not, hence the buffer.
    let stdoutBuf = '';
    // Cap activity emits so a pathological run can't fire thousands of S3 PUTs.
    // The full trace + report still capture everything; this only bounds the
    // live feed. We emit one warning when the cap trips, then go quiet.
    const MAX_ACTIVITY_EVENTS = 200;
    let activityCount = 0;
    let activityCapNoted = false;
    child.stdout.on('data', (buf) => {
      stdoutBuf += buf.toString('utf-8');
      const lines = stdoutBuf.split('\n');
      // Last element is an incomplete line (no trailing \n yet) — hold it back.
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const phase = parsePhaseFromLine(line);
        if (phase && phase !== latestPhase) {
          latestPhase = phase;
          // Fire-and-forget phase transition — don't block stdout handler on S3.
          emitEvent('phase.started', { phase }).catch((err) => logEmitFailure('phase.started', err));
        }
        if (line.length > 0) latestEvent = line.slice(0, 240);

        // Curated tool activity → live feed. Best-effort, never throws.
        for (const activity of extractToolActivities(line)) {
          if (activityCount >= MAX_ACTIVITY_EVENTS) {
            if (!activityCapNoted) {
              activityCapNoted = true;
              console.log('[investigator] activity.cap.reached', { investigationId, cap: MAX_ACTIVITY_EVENTS });
            }
            break;
          }
          activityCount += 1;
          emitEvent('activity', activity).catch((err) => logEmitFailure('activity', err));
        }
      }
    });

    // `finalized` guards the heartbeat against clobbering the terminal write.
    // `clearInterval` stops scheduling new ticks but an in-flight S3 PUT from
    // a tick that already fired can still land AFTER the final mergeState
    // below — mergeState is read-modify-write, so a late tick that read the
    // pre-terminal state would write `status: running` over `status: completed`
    // and the UI would poll forever until it marked the heartbeat stale. The
    // guard lets us reject late writes instead of merging them.
    let finalized = false;
    let heartbeatFailures = 0;
    // Re-log every Nth failure (not just the first) so a persistent S3
    // outage shows up in CloudWatch as a recurring signature instead of
    // a single line buried 14 minutes ago. We carry the running count
    // through to the final state document below so a stranded
    // investigation surfaces "heartbeat wrote N/M times" without
    // requiring CloudWatch correlation.
    const HEARTBEAT_RELOG_EVERY = 10;
    const heartbeat = setInterval(() => {
      if (finalized) return;
      emitEvent('heartbeat', { phase: latestPhase, lastEvent: latestEvent }).catch((err) => logEmitFailure('heartbeat', err));
      mergeState(stateKey, {
        heartbeatAt: new Date().toISOString(),
        phase: latestPhase,
        lastEvent: latestEvent,
      }).catch((err) => {
        heartbeatFailures += 1;
        if (
          heartbeatFailures === 1 ||
          heartbeatFailures % HEARTBEAT_RELOG_EVERY === 0
        ) {
          console.error('[investigator] heartbeat write failed', {
            stateKey,
            occurrence: heartbeatFailures,
            err,
          });
        }
      });
    }, HEARTBEAT_MS);

    // Reserve VERIFIER_BUDGET_MS inside MAX_RUN_MS so the fresh-context
    // judge spawn (below) has headroom before the 15-minute Lambda cap.
    const childRunMs = Math.max(60_000, MAX_RUN_MS - VERIFIER_BUDGET_MS - (Date.now() - started));
    const killTimer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, 5_000).unref();
    }, childRunMs);

    const exitInfo = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    // Order matters:
    //   1. flip `finalized` so any already-scheduled heartbeat callback that
    //      runs during the interval teardown returns early
    //   2. stop scheduling new heartbeats
    //   3. wait for the trace stream to flush to disk BEFORE we read it for
    //      upload — logStream.end() only schedules the final write; without
    //      awaiting 'finish' we can upload a truncated trace on fast runs.
    finalized = true;
    clearInterval(heartbeat);
    clearTimeout(killTimer);
    await new Promise((resolve) => {
    logStream.once('finish', resolve);
    logStream.end();
    });

    // Locate report markdown (skill writes under REPORT_DIR on laptop runs;
    // in Lambda the skill ends by asking the user whether to save, and nobody
    // answers, so the file is typically absent).
    let reportMd = '';
    let reportName = `${appId}.md`;
    let entries = [];
    try {
    entries = await fs.readdir(workDir);
    } catch (err) {
    // readdir fails when workDir is missing — expected on very-early exits.
    if (err && err.code !== 'ENOENT') {
      console.error('[investigator] failed to list REPORT_DIR', workDir, err);
    }
    }
    const md = entries.find((f) => f.endsWith('.md'));
    if (md) {
    try {
      reportName = md;
      reportMd = await fs.readFile(path.join(workDir, md), 'utf-8');
    } catch (err) {
      // Found a .md file but can't read it — distinct from "skill never
      // wrote one". Log instead of silently falling through to the trace
      // scraper so we notice permission / disk issues.
      console.error('[investigator] failed to read report file', md, err);
      reportMd = '';
    }
    }

    // Read analysis sidecar written by the synthesis phase. Best-effort —
    // missing file is normal for failed/killed runs or pre-feature invocations.
    let analysisSidecar = null;
    const analysisFile = entries.find((f) => f.endsWith('.analysis.json'));
    if (analysisFile) {
      try {
        const raw = await fs.readFile(path.join(workDir, analysisFile), 'utf-8');
        analysisSidecar = JSON.parse(raw);
      } catch (err) {
        console.error('[investigator] failed to read analysis sidecar', analysisFile, err);
      }
    }

    // Fallback: scrape the final assistant text out of the Claude CLI
    // stream-json trace. The skill *should* write `${REPORT_DIR}/{appId}.md`
    // directly (see phases/phase-2-synthesis.md), in which case the readdir
    // above succeeds and this fallback never fires. When the file is
    // missing the trace is the only forensic trail we have, so we stitch
    // assistant text blocks together — but with two narration safeguards:
    //
    //   1. Only stitch text that appears AFTER the first `phase-2-synthesis`
    //      marker line in the trace. Phase 0/1 chatter ("Sources complete",
    //      "Drilling into raw refs", etc.) gets dropped, so the customer-
    //      visible CRM caseNote summary derived from the first non-heading
    //      line of `reportMd` doesn't end up quoting model intent. If no
    //      `phase-2-synthesis` marker is found, we fall back to stitching
    //      all assistant text (legacy behavior) — better a noisy report
    //      than no report at all.
    //   2. Prepend a banner that flags the report as reconstructed from
    //      trace, so anyone reviewing it (support agents, on-call) knows
    //      to expect lower fidelity than a properly-saved synthesis file.
    //
    // The skill's `## Output discipline` section in SKILL.md and the
    // synthesis phase doc both tell the model to stay silent in chat —
    // these are soft prompt-discipline contracts, not enforced. The two
    // safeguards here are the enforcement.
    if (!reportMd) {
    try {
      const traceRaw = await fs.readFile(traceLocalPath, 'utf-8');
      // First pass: collect ALL assistant text blocks, in order, with the
      // index of the block that contains the phase-2-synthesis marker (if
      // any). The marker can either be the entire block (when the model
      // emits a heartbeat line) or a substring inside a longer block.
      const allBlocks = [];
      let phase2Index = -1;
      for (const line of traceRaw.split('\n')) {
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type !== 'assistant') continue;
        const content = evt?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const c of content) {
          if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            const text = c.text;
            if (phase2Index === -1 && /phase-2-synthesis/i.test(text)) {
              phase2Index = allBlocks.length;
            }
            allBlocks.push(text);
          }
        }
      }

      // Strip everything before and including the phase-2 marker line
      // when we found one; otherwise keep the legacy "stitch all text"
      // behavior so we don't lose the report on a model that skipped
      // the heartbeat.
      const reportBlocks = phase2Index >= 0
        ? allBlocks.slice(phase2Index + 1)
        : allBlocks;

      if (reportBlocks.length > 0) {
        const synthesized = reportBlocks.join('\n\n').trim();
        const saveAskRegex = /\n+[^\n]*want me to save[^\n]*\?\s*$/i;
        const stripped = synthesized.replace(saveAskRegex, '').trim();
        // Banner is intentionally Markdown-quoted so the deriveSummary
        // helper (handler.mjs:256) skips past it (it skips '#' and blank
        // lines but not '>' — so we put a one-line `_(reconstructed...)_`
        // italic line FIRST, then the banner, then a blank line, then
        // the report. deriveSummary takes the first non-blank, non-'#'
        // line — the italic note. That's a known cost: the CRM caseNote
        // summary on a fallback run shows the reconstruction note
        // instead of the TL;DR sentence. Acceptable, because (a) the
        // operator reading the summary needs to know fidelity is
        // reduced, and (b) the full report is one click away via the
        // investigate URL.
        const banner = '_⚠️ Report reconstructed from execution trace; the synthesis file was not saved by the skill. Output may include partial findings or model narration._';
        reportMd = `${banner}\n\n${stripped}`;
        reportName = `${appId}.md`;
        console.warn('[investigator] report.fallback.trace_stitched', {
          investigationId,
          phase2MarkerFound: phase2Index >= 0,
          stitchedBlockCount: reportBlocks.length,
          totalAssistantBlocks: allBlocks.length,
        });
      }
    } catch (err) {
      // ENOENT = trace was never written (extremely early crash). Any
      // other code (EACCES, ENOSPC, ...) is unexpected and worth surfacing
      // in CloudWatch so we notice it. Either way we fall through with an
      // empty report; the UI renders "no report content".
      if (err && err.code !== 'ENOENT') {
        console.error('[investigator] trace fallback read failed', err);
      }
    }
    }

    // Exit codes 143 (128+SIGTERM) and 137 (128+SIGKILL) indicate the process
    // caught the signal and exited with a numeric code instead of dying via the
    // signal directly. Node's child_process reports signal=null + code=143 in
    // that case, so we check both paths.
    const wasKilled =
    exitInfo.signal === 'SIGTERM' || exitInfo.signal === 'SIGKILL' ||
    exitInfo.code === 143 || exitInfo.code === 137;
    const status = wasKilled
    ? 'killed'
    : exitInfo.code === 0
      ? 'completed'
      : 'failed';

    // Upload trace.jsonl — primary forensic artifact. Swallowing failures
    // silently leaves completed-looking investigations with no debuggable
    // trace; CloudWatch is the only place that can surface it.
    const traceKey = `${tracePrefix || historyPrefix + investigationId + '/'}trace.jsonl`;
    try {
    const traceBody = await fs.readFile(traceLocalPath);
    await putText(traceKey, traceBody, 'application/x-ndjson');
    } catch (err) {
    console.error('[investigator] trace upload failed', { traceKey, err });
    }

    // Extract cost/usage from the final stream-json `result` event so the
    // console UI can render a cost block beneath the report. Walk lines
    // from the end — the result event is the last non-blank line on a
    // clean exit. Best-effort; missing cost is non-fatal.
    let cost = null;
    try {
      const traceRaw = await fs.readFile(traceLocalPath, 'utf-8');
      const lines = traceRaw.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type !== 'result') continue;
        const u = evt.usage || {};
        const cacheCreate = u.cache_creation_input_tokens || 0;
        const cacheRead = u.cache_read_input_tokens || 0;
        const freshInput = u.input_tokens || 0;
        const inputTokens = freshInput + cacheCreate + cacheRead;
        const outputTokens = u.output_tokens || 0;
        const totalUsd = typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : null;
        if (totalUsd != null) {
          cost = { totalUsd, inputTokens, outputTokens };
        }
        // Surface prompt-cache stats as a top-level structured log so we
        // can verify cache hits are happening (Anthropic API auto-caches
        // tools + system blocks for any Claude Code client). A healthy
        // run has cacheRead >> cacheCreate after the first turn; if
        // cacheRead is zero across many runs the cache breakpoint is
        // misaligned and we are paying full price every turn.
        const cacheRatio = inputTokens > 0
          ? Math.round((cacheRead / inputTokens) * 100) / 100
          : 0;
        console.log('[investigator] claude.usage.summary', JSON.stringify({
          investigationId,
          freshInputTokens: freshInput,
          cacheCreationTokens: cacheCreate,
          cacheReadTokens: cacheRead,
          totalInputTokens: inputTokens,
          outputTokens,
          cacheReadRatio: cacheRatio,
          totalUsd,
        }));
        break;
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.error('[investigator] cost extraction failed', err);
      }
    }

    // Upload report. If this fails, still write a terminal state so the UI does
    // not sit in running/stale with a report that only existed in Lambda memory.
    let reportUploaded = false;
    if (reportMd) {
    try {
      await putText(resultKey, reportMd, 'text/markdown; charset=utf-8');
      reportUploaded = true;
    } catch (err) {
      console.error('[investigator] report upload failed', { resultKey, err });
    }
    }

    if (reportUploaded) {
      await emitEvent('report.ready', { resultKey, reportFilename: reportName });
    }

    // Degraded-coverage guard: a run missing the customer app code or the
    // agent conversation cannot support a HIGH-confidence verdict — especially
    // a confident "no app bug" (no-issue / customer-error) that would land in a
    // CRM note. Cap confidence to 'medium' and record why. Runs BEFORE the
    // verifier so the judge can still downgrade further to 'low'.
    if (analysisSidecar && (!appCodeAvailable || !conversationsAvailable)) {
      const missing = [
        !appCodeAvailable ? 'customer app code' : null,
        !conversationsAvailable ? 'agent conversation' : null,
      ].filter(Boolean).join(' + ');
      analysisSidecar.coverageNote = `Partial evidence: ${missing} unavailable; verdict confidence capped.`;
      if (analysisSidecar.verdictConfidence === 'high') {
        analysisSidecar.verdictConfidence = 'medium';
        console.log('[investigator] verdict.confidence.capped — partial coverage', {
          investigationId,
          missing,
        });
      }
    }

    // Fresh-context verifier (LLM-as-judge). After a clean completion with
    // both a report and an analysis sidecar, run a SEPARATE single-shot
    // `claude -p` judge that scores the report+verdict+fix against a rubric
    // (see verifier.mjs). On a judge FAILURE we downgrade the analysis
    // verdictConfidence to 'low' and attach a verifierNote — fail-closed —
    // BEFORE the analysis upload below so the downgraded copy is what
    // debug-console reads. The judge is a strict soft-fail: any error
    // (spawn/timeout/invalid JSON) returns { ran: false } and the analysis
    // ships unchanged. The whole block is wrapped so it can NEVER block or
    // fail the finalize path.
    if (analysisSidecar && status === 'completed' && reportMd) {
      try {
        // Cap the judge's budget to what's left of the reserved window so it
        // can't push the invocation past the Lambda cap.
        const remainingMs = MAX_RUN_MS - (Date.now() - started);
        const verifierTimeoutMs = Math.max(30_000, Math.min(VERIFIER_BUDGET_MS, remainingMs));
        const v = await runVerifier({
          reportMd,
          analysis: analysisSidecar,
          complaint: feedback,
          timeWindow,
          workDir,
          appId,
          timeoutMs: verifierTimeoutMs,
        });
        if (v.ran && v.pass === false) {
          // Fail-closed: an unsupported / overconfident verdict gets pinned
          // to low confidence so downstream consumers don't trust it.
          analysisSidecar.verdictConfidence = 'low';
          if (v.note) analysisSidecar.verifierNote = v.note;
          console.log('[investigator] verifier.failed', {
            investigationId,
            score: v.score ?? null,
            note: v.note ?? null,
          });
          emitEvent('investigation.warning', {
            source: 'verifier',
            message: 'Verifier downgraded verdict confidence: report/verdict not supported by cited evidence',
            note: v.note ?? null,
            score: v.score ?? null,
          }).catch((emitErr) => logEmitFailure('investigation.warning', emitErr));

          // Feedback loop: an over-claim is a candidate lesson for the
          // knowledge base. Persist it to the lessons inbox for human
          // curation (scripts/investigate-distill-lessons.mjs → PR into
          // references/aab-behaviors.md). Best-effort — never blocks finalize.
          try {
            const lesson = buildLessonRecord({
              investigationId,
              appId,
              customerId,
              ts: new Date().toISOString(),
              source: 'verifier',
              analysis: analysisSidecar,
              verifierNote: v.note ?? null,
              score: v.score ?? null,
              feedback,
              timeWindow,
            });
            await putJson(lessonKey(lesson), lesson);
          } catch (lessonErr) {
            console.error('[investigator] lesson.capture.failed', {
              investigationId,
              error: lessonErr && lessonErr.message ? lessonErr.message : String(lessonErr),
            });
          }
        } else if (v.ran && v.pass === true) {
          console.log('[investigator] verifier.passed', {
            investigationId,
            score: v.score ?? null,
          });
        }
        // v.ran === false → soft-fail: leave the analysis unchanged.
        // Machine-readable marker so consumers can distinguish a VERIFIED
        // verdict from one shipped unverified (judge timeout / spawn-fail /
        // invalid JSON). true only when the judge actually ran.
        analysisSidecar.verified = v.ran === true;
      } catch (err) {
        // The verifier must NEVER block finalize. runVerifier already
        // soft-fails internally; this is belt-and-suspenders.
        console.error('[investigator] verifier.block.error', {
          investigationId,
          error: err && err.message ? err.message : String(err),
        });
      }
    }

    // Upload analysis sidecar so debug-console can populate sentiment/rootCause
    // fields in the investigation summary listing. Best-effort — failure here
    // does NOT affect the investigation result.
    if (analysisSidecar && status === 'completed') {
      const analysisKey = `analysis/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/${investigationId}.json`;
      try {
        await putJson(analysisKey, analysisSidecar);
      } catch (err) {
        console.error('[investigator] analysis sidecar upload failed', { analysisKey, err });
      }
    }

    const terminalType =
      status === 'completed'
        ? 'investigation.completed'
        : status === 'killed'
          ? 'investigation.killed'
          : 'investigation.failed';
    await emitEvent(terminalType, {
      status,
      phase: latestPhase,
      durationMs: Date.now() - started,
      reason: wasKilled ? 'timeout' : undefined,
      error: status === 'failed' ? `claude exit code ${exitInfo.code}` : undefined,
    });

    const finalState = await mergeState(stateKey, {
      status,
      phase: latestPhase,
      lastEvent: wasKilled
        ? 'investigation exceeded time limit'
        : status === 'completed'
          ? 'report written'
          : `claude exited with code ${exitInfo.code}`,
      heartbeatAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      resultKey: reportUploaded ? resultKey : null,
      reportFilename: reportUploaded ? reportName : null,
      // Carry the heartbeat failure counter so a stranded investigation's
      // state document tells operators how many heartbeat writes were lost
      // without requiring a CloudWatch correlation.
      heartbeatFailures,
      cost,
      error: status === 'failed' ? `claude exit code ${exitInfo.code}` : null,
    });
    // Terminal state is now persisted — the catch must not overwrite it.
    terminalRecorded = true;

    // Freeze into history — `active/` is overwritten on the next run for the
    // same (customer, app), so if these copies silently fail the completed
    // investigation is unrecoverable. Log to CloudWatch instead of eating
    // the error; the UI already has the result.md via the active/ slot, so
    // failure here doesn't block the current user — it only affects future
    // retrieval of THIS run.
    if (historyPrefix) {
    try {
      await snapshotToHistory(stateKey, historyPrefix, investigationId);
    } catch (err) {
      console.error('[investigator] history state snapshot failed', {
        historyPrefix, investigationId, err,
      });
    }
    if (reportUploaded) {
      const historyReportKey = `${historyPrefix}${investigationId}/result.md`;
      try {
        await s3.send(new CopyObjectCommand({
          Bucket: STATE_BUCKET,
          CopySource: `${STATE_BUCKET}/${resultKey}`,
          Key: historyReportKey,
          ContentType: 'text/markdown; charset=utf-8',
          MetadataDirective: 'REPLACE',
        }));
      } catch (err) {
        console.error('[investigator] history report copy failed', {
          historyReportKey, err,
        });
      }
    }
    }

    const reportSummary = deriveSummary(reportMd);
    await maybeAddCrmCaseNote({
      status: finalState.status,
      crmCaseId: event.crmCaseId,
      investigationId,
      appId: event.appId,
      customerId: event.customerId,
      reportSummary,
    });

    // Cleanup work dir to keep /tmp healthy across warm invocations. Failure
    // here isn't fatal — /tmp is 2 GiB and Lambda refreshes it on cold start,
    // but log it anyway so we notice if something holds the directory open.
    try {
    await fs.rm(workDir, { recursive: true, force: true });
    } catch (err) {
    console.error('[investigator] workDir cleanup failed', { workDir, err });
    }

    return { statusCode: 200, body: JSON.stringify({ investigationId, status: finalState.status }) };
  } catch (err) {
    // The main body previously had no catch: an uncaught throw (fs.mkdir,
    // createWriteStream, spawnClaude, a terminal mergeState, …) would escape
    // after the finally cleared creds WITHOUT recording terminal state, so the
    // UI spun at "running" until the ~15-min stale cutoff with no reason.
    // Record a terminal failed state + emit the failed event so the dashboard
    // shows the failure immediately. Best-effort — never throw out of here.
    const errorMessage = err && err.message ? err.message : String(err);
    if (terminalRecorded) {
      // A post-terminal callee threw AFTER the good verdict was persisted. Do
      // NOT overwrite it — the UI reads the terminal state from S3. Just log.
      console.error('[investigator] post-terminal error — terminal state preserved', {
        investigationId,
        error: errorMessage,
      });
      return { statusCode: 200, body: JSON.stringify({ investigationId }) };
    }
    console.error('[investigator] investigation.uncaught — recording failed state', {
      investigationId,
      error: errorMessage,
    });
    await emitEvent('investigation.failed', {
      status: 'failed',
      durationMs: Date.now() - started,
      error: errorMessage.slice(0, 240),
    }).catch((emitErr) => logEmitFailure('investigation.failed', emitErr));
    await tryReleaseLockAsFailed(stateKey, {
      status: 'failed',
      lastEvent: 'investigation failed with an unexpected error',
      error: errorMessage.slice(0, 240),
      heartbeatAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    });
    // Return (don't rethrow): an async Lambda re-throw can trigger a retry that
    // double-runs the investigation; the failure is already recorded in state.
    return {
      statusCode: 500,
      body: JSON.stringify({ investigationId, status: 'failed', error: errorMessage.slice(0, 240) }),
    };
  } finally {
    // Drop the per-invocation creds regardless of exit path so they don't
    // linger into the next warm-container invocation. `delete` rather
    // than assigning '' so any downstream code that reads them gets an
    // unambiguous "not set" rather than empty string. Direct-mode evidence
    // creds must be cleared too — leaving them set would leak Loki / ES
    // keys into a subsequent invocation.
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.INVESTIGATION_DIRECT_MODE;
    delete process.env.LOKI_API_KEY;
    delete process.env.AIRO_BUILDER_ES_API_KEY;
    // Per-invocation Loki cluster scope: clear it so a warm container's next
    // run can't reuse the previous app's cluster (which would scope its
    // queries to the wrong cluster and silently return nothing).
    delete process.env.LOKI_CLUSTER;
    // Code/conversation context pointers are per-invocation: clear them so a
    // warm container's next run can't read a stale app dir or conversations
    // file from a previous (customer, app).
    delete process.env.APP_CODE_DIR;
    delete process.env.CONVERSATIONS_PATH;
    // Platform graph root pointer is per-invocation too: clear it so a warm
    // container's next run re-resolves it (and a soft-fail run doesn't leave a
    // stale root pointing at an evicted /tmp file).
    delete process.env.PLATFORM_GRAPH_ROOT;
    // Per-invocation report dir pointer — clear it too so the documented
    // "no per-invocation env survives the finally" invariant holds.
    delete process.env.REPORT_DIR;
  }
}
