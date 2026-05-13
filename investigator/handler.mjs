import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import gdAuth from 'gd-auth-client';

import { buildPrompt } from './prompt.mjs';
import { createEventEmitter } from './events.mjs';
import { decodeJwtExpMs, buildChildEnv } from './auth.mjs';
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
const MAX_RUN_MS = 14 * 60_000; // leave 1 min buffer under Lambda's 15 min cap
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

async function mergeState(stateKey, patch) {
  // This is intentionally last-writer-wins. Heartbeats may race each other, but
  // they only update progress fields. The `finalized` guard below prevents the
  // dangerous case where a late heartbeat overwrites terminal state. If BFF vs
  // Lambda write collisions become observable, carry the S3 ETag from readJson
  // and put with IfMatch instead of broadening the lock model prematurely.
  // Read the current state document. A missing key means this is the
  // first write after acquireLock in the BFF (normal). Any other error
  // (AccessDenied, NoSuchBucket, network partition) is abnormal and we
  // want CloudWatch to capture it rather than silently fall through with
  // an empty base that would write a structurally partial document.
  let cur = {};
  try {
    cur = await readJson(stateKey);
  } catch (err) {
    const is404 =
      err?.name === 'NoSuchKey' ||
      err?.name === 'NotFound' ||
      err?.$metadata?.httpStatusCode === 404;
    if (!is404) {
      console.error('[investigator] mergeState read failed', { stateKey, err });
    }
  }
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await putJson(stateKey, next);
  return next;
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
    '--max-turns', '35',
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

  try {
    await mergeState(stateKey, {
      status: 'running',
      phase: 'bootstrap',
      lastEvent: 'lambda handler entered',
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
  if (!jomaxToken || typeof jomaxToken !== 'string') {
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

  try {
    process.env.JOMAX_TOKEN = jomaxToken;
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

    // Tap stdout for phase markers. Pipe already handles writing to trace file.
    child.stdout.on('data', (buf) => {
    const s = buf.toString('utf-8');
    for (const line of s.split('\n')) {
      const phase = parsePhaseFromLine(line);
      if (phase && phase !== latestPhase) {
        latestPhase = phase;
        // Fire-and-forget phase transition — don't block stdout handler on S3.
        emitEvent('phase.started', { phase }).catch(() => {});
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
      emitEvent('heartbeat', { phase: latestPhase, lastEvent: latestEvent }).catch(() => {});
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

    // Fallback: scrape the final assistant text out of the Claude CLI
    // stream-json trace. The Slack-ready summary that phase-6-synthesis emits
    // always ends up in an assistant message; we stitch any assistant text
    // blocks together and drop the trailing "Want me to save a full report?"
    // prompt line.
    if (!reportMd) {
    try {
      const traceRaw = await fs.readFile(traceLocalPath, 'utf-8');
      const parts = [];
      for (const line of traceRaw.split('\n')) {
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type !== 'assistant') continue;
        const content = evt?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const c of content) {
          if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            parts.push(c.text);
          }
        }
      }
      if (parts.length > 0) {
        const synthesized = parts.join('\n\n').trim();
        const saveAskRegex = /\n+[^\n]*want me to save[^\n]*\?\s*$/i;
        reportMd = synthesized.replace(saveAskRegex, '').trim();
        reportName = `${appId}.md`;
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
    // unambiguous "not set" rather than empty string.
    delete process.env.JOMAX_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
}
