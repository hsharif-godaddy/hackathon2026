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
// Re-export pure helpers so existing import paths in tests keep working.
export { decodeJwtExpMs, buildChildEnv };

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

  // Per-invocation secrets (jomaxToken; gocodeApiKey on the legacy path)
  // are set on process.env inside the handler and cleared in its finally
  // block so they never leak into the next warm-container invocation.
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

function spawnClaude(prompt, logStream) {
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
    fullstoryUrl,
    timeWindow,
    stateKey,
    historyPrefix,
    resultKey,
    tracePrefix,
    eventsPrefix,
    jomaxToken,
    gocodeApiKey,
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
    input: { feedback, fullstoryUrl, timeWindow },
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

  // Per-invocation credentials:
  //   - JOMAX token   → forwarded from caller; scopes downstream API calls
  //                     to the user who triggered this investigation.
  //   - GoCode auth   → depends on GOCODE_USE_S2S_AUTH:
  //                       'true'  → mint IAM JWT via gd-auth-client using
  //                                 the Lambda execution role directly
  //                                 (no STS assume; ignores gocodeApiKey
  //                                 from payload). Role must be registered
  //                                 with GoCode S2S — see README.
  //                       'false' → use gocodeApiKey from invoke payload
  //                                 (legacy; kept for fast manual rollback
  //                                 via Lambda console env var flip).
  // Both live in process env for this invocation only and are cleared in a
  // finally block below — Lambda reuses warm containers, so an exception
  // escaping before cleanup could leak creds into the next invocation.
  // feedback-source invocations are triggered by the BFF fan-out (no user session).
  // They rely on the Lambda's IAM identity for downstream calls; jomaxToken is
  // not available and not required on this path.
  if (source !== 'feedback' && (!jomaxToken || typeof jomaxToken !== 'string')) {
    await emitEvent('investigation.failed', { phase: 'credentials', error: 'jomaxToken missing' });
    await tryReleaseLockAsFailed(stateKey, {
      status: 'failed',
      lastEvent: 'missing jomax token from caller',
      completedAt: new Date().toISOString(),
      error: 'jomaxToken missing from invoke payload — console failed to forward user session',
    });
    return { statusCode: 400, body: 'jomaxToken required' };
  }

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
    // Legacy auth path: caller forwards a gocodeApiKey. The BFF fan-out
    // (source==='feedback') never has a user-side API key — it relies on
    // the Lambda's IAM identity via S2S — so flipping GOCODE_USE_S2S_AUTH
    // off would break feedback-source invocations. Fail fast with an
    // explicit message so a future operator who flips the env var for
    // rollback gets a clear cause rather than the generic "key missing".
    if (source === 'feedback') {
      await emitEvent('investigation.failed', {
        phase: 'credentials',
        error: 'feedback source requires GOCODE_USE_S2S_AUTH=true',
      });
      await tryReleaseLockAsFailed(stateKey, {
        status: 'failed',
        lastEvent: 'feedback source incompatible with legacy gocodeApiKey auth',
        completedAt: new Date().toISOString(),
        error: 'feedback-source invocations require GOCODE_USE_S2S_AUTH=true (no user gocodeApiKey available)',
      });
      return { statusCode: 400, body: 'feedback requires s2s auth' };
    }
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

  try {
    // feedback-source: bypass debug-console entirely — load evidence
    // credentials from Secrets Manager and set them as env vars so the
    // Python skill queries Loki / EB Langfuse / ES directly via
    // INVESTIGATION_DIRECT_MODE.
    //
    // Failure semantics are NEGATIVE-ONLY by design: the success path
    // doesn't write `evidenceCredsLoaded: true` to state.json. A dashboard
    // polling /api/investigate/{id}/status distinguishes
    //   - "partial evidence run"  → state has `evidenceCredsLoaded: false`
    //   - "fully healthy run"     → field is absent
    //   - "console-source run"    → field is absent (non-feedback path)
    // Conflating the latter two is OK: console-source already authenticates
    // through JOMAX and never goes through this branch, so its absence
    // genuinely means "no degradation here."
    if (source === 'feedback') {
      try {
        const creds = await loadEvidenceCredentials();
        process.env.LOKI_API_KEY = creds.lokiApiKey;
        process.env.EB_LANGFUSE_PUBLIC_KEY = creds.ebLangfusePublicKey;
        process.env.EB_LANGFUSE_SECRET_KEY = creds.ebLangfuseSecretKey;
        process.env.AIRO_BUILDER_ES_API_KEY = creds.airoBuilderEsApiKey;
        process.env.CONTROL_PLANE_ES_API_KEY = creds.controlPlaneEsApiKey;
        process.env.FULLSTORY_API_KEY = creds.fullstoryApiKey;
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
    }
    process.env.JOMAX_TOKEN = jomaxToken ?? '';
    process.env.ANTHROPIC_AUTH_TOKEN = gocodeAuthToken;

    const workDir = `/tmp/${investigationId}`;
    await fs.mkdir(workDir, { recursive: true });
    process.env.REPORT_DIR = workDir;

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

    const prompt = buildPrompt({ appId, feedback, fullstoryUrl, timeWindow });
    const child = spawnClaude(prompt, logStream);

    let latestPhase = 'claude-analysis';
    let latestEvent = 'claude searching telemetry';

    // (logEmitFailure + emitEventFailures are hoisted above the try
    // block so the evidence-credentials degradation emit can share the
    // same counter. See review S-13 follow-up note above.)

    // Tap stdout for phase markers. Pipe already handles writing to trace file.
    child.stdout.on('data', (buf) => {
    const s = buf.toString('utf-8');
    for (const line of s.split('\n')) {
      const phase = parsePhaseFromLine(line);
      if (phase && phase !== latestPhase) {
        latestPhase = phase;
        // Fire-and-forget phase transition — don't block stdout handler on S3.
        emitEvent('phase.started', { phase }).catch((err) => logEmitFailure('phase.started', err));
      }
      if (line.length > 0) latestEvent = line.slice(0, 240);
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

    const childRunMs = Math.max(60_000, MAX_RUN_MS - (Date.now() - started));
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
  } finally {
    // Drop the per-invocation creds regardless of exit path so they don't
    // linger into the next warm-container invocation. `delete` rather
    // than assigning '' so any downstream code that reads them gets an
    // unambiguous "not set" rather than empty string. Direct-mode evidence
    // creds must be cleared too — leaving them set would leak Loki / ES /
    // Langfuse / FullStory keys into a subsequent non-feedback invocation
    // that should run via the console proxy with JOMAX, not direct mode.
    delete process.env.JOMAX_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.INVESTIGATION_DIRECT_MODE;
    delete process.env.LOKI_API_KEY;
    delete process.env.EB_LANGFUSE_PUBLIC_KEY;
    delete process.env.EB_LANGFUSE_SECRET_KEY;
    delete process.env.AIRO_BUILDER_ES_API_KEY;
    delete process.env.CONTROL_PLANE_ES_API_KEY;
    delete process.env.FULLSTORY_API_KEY;
  }
}
