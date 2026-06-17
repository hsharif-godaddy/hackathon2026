// Async Lambda handler for the fresh-context verifier.
// Invoked by the main investigator Lambda after writing the terminal report.
// Reads result.md + analysis.json from S3, runs judge(), patches ONLY the
// analysis sidecar (NEVER state.json), emits a refinement event at startSeq.
//
// All errors are soft-fail: the main investigation has already been finalized.

import { judge } from './verifier.mjs';
import { createInvestigatorModels } from './provider.mjs';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Core verifier logic (injectable deps for testing).
 *
 * @param {{
 *   event: { resultKey: string, analysisKey: string, appId?: string, complaint?: string, timeWindow?: string|null, startSeq?: number, eventsPrefix?: string, investigationId?: string },
 *   s3: { getObject: Function, putObject: Function },
 *   judgeImpl?: Function,
 *   emitEvent?: Function,
 *   model?: any,
 * }} opts
 */
export async function runVerifierHandler({ event, s3, judgeImpl = judge, emitEvent, model } = {}) {
  const { resultKey, analysisKey, appId, complaint, timeWindow, startSeq } = event || {};

  if (!resultKey || !analysisKey) {
    console.error('[verifier-handler] missing resultKey or analysisKey in event');
    return;
  }

  try {
    // Read report + analysis from S3
    const [reportRes, analysisRes] = await Promise.all([
      s3.getObject({ Key: resultKey }),
      s3.getObject({ Key: analysisKey }),
    ]);

    const reportMd = typeof reportRes.Body === 'string' ? reportRes.Body : reportRes.Body?.toString?.() ?? '';
    let analysis = {};
    try { analysis = JSON.parse(typeof analysisRes.Body === 'string' ? analysisRes.Body : analysisRes.Body?.toString?.() ?? '{}'); } catch { /* ok */ }

    // Run the judge (pass model when available)
    const result = await judgeImpl({ reportMd, analysis, complaint, timeWindow, workDir: '/tmp', appId, model });

    // Patch the analysis sidecar only
    const patch = { ...analysis, verified: result.ran };
    if (result.ran && !result.pass) {
      // Fail-closed: pin confidence to 'low' so downstream consumers don't
      // trust a verdict the judge couldn't support. Same semantics as the
      // in-process runVerifier path in handler.mjs.
      patch.verdictConfidence = 'low';
      if (result.note) patch.verifierNote = result.note;
    }
    if (result.score != null) patch.verifierScore = result.score;

    await s3.putObject({ Key: analysisKey, Body: JSON.stringify(patch, null, 2), ContentType: 'application/json' });

    // Emit refinement event at the exact seq slot reserved by the main Lambda.
    // H3: write directly to the startSeq key rather than using an independent
    // emitter (which would start at seq=0 and collide with the main stream).
    if (result.ran && emitEvent) {
      await emitEvent('investigation.verdict_refined', {
        // Fall back to null (not undefined) when the analysis blob lacked the
        // field — undefined drops from JSON, leaving consumers a missing key.
        verdict: patch.verdict ?? null,
        verdictConfidence: patch.verdictConfidence ?? null,
        verifierPassed: result.pass,
        verifierNote: result.note ?? null,
      });
    }
  } catch (err) {
    // Soft-fail: the main investigation is already finalized
    console.error('[verifier-handler] error', { error: err?.message });
  }
}

/**
 * Build a single-shot event emitter that writes ONE event to the exact S3 key
 * at startSeq, continuing the main Lambda's event stream (H3 fix).
 * Returns null when eventsPrefix is absent (backward compat).
 */
export function buildSingleEventEmitter(s3Client, bucket, eventsPrefix, investigationId, startSeq) {
  if (!eventsPrefix || typeof startSeq !== 'number') return null;
  return async function emitSingleEvent(type, data = {}) {
    const evt = {
      v: 1,
      seq: startSeq,
      investigationId: investigationId ?? '',
      ts: new Date().toISOString(),
      type,
      data,
    };
    const key = `${eventsPrefix}${String(startSeq).padStart(6, '0')}.json`;
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(evt),
        ContentType: 'application/json',
        CacheControl: 'no-store',
      }));
    } catch (err) {
      console.error('[verifier-handler] emit failed', { key, type, err: err?.message });
    }
  };
}

/**
 * Lambda handler entry point.
 */
export const handler = async (event) => {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  const bucket = process.env.STATE_BUCKET;

  // Wrap S3 to match the injectable interface
  const s3Wrapper = {
    getObject: async (params) => {
      const cmd = new GetObjectCommand({ Bucket: bucket, ...params });
      const res = await s3.send(cmd);
      const body = await res.Body.transformToString();
      return { Body: body };
    },
    putObject: async (params) => {
      const cmd = new PutObjectCommand({ Bucket: bucket, ...params });
      await s3.send(cmd);
    },
  };

  // Build model from env (same GoCode proxy config as the main Lambda)
  const JWT_MINT_TIMEOUT_MS = 15_000;
  let verifierModel;
  try {
    const s2sEnabled = process.env.GOCODE_USE_S2S_AUTH === 'true';
    let authToken;
    if (s2sEnabled) {
      // Mint a fresh JWT with the same timeout race as the main handler
      // (handler.mjs:165) — an SSO hang would otherwise burn the full
      // verifier Lambda budget before soft-failing to "no model."
      // gd-auth-client is CJS with IamTokenClient on its default export. A
      // named destructure off the dynamic-import namespace can be undefined
      // under CJS interop — read it off .default first (matches handler.mjs).
      const gdAuth = await import('gd-auth-client');
      const IamTokenClient = gdAuth.default?.IamTokenClient ?? gdAuth.IamTokenClient;
      const client = new IamTokenClient(process.env.SSO_HOST);
      authToken = await Promise.race([
        client.getToken(),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`IamTokenClient.getToken timed out after ${JWT_MINT_TIMEOUT_MS}ms`)),
            JWT_MINT_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
    }
    const models = createInvestigatorModels({
      useS2S: s2sEnabled,
      authToken,
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });
    verifierModel = models.lead;
  } catch (err) {
    // Soft-fail: model creation failing means judge returns {ran:false}
    console.error('[verifier-handler] model init failed', { error: err?.message });
  }

  // Build single-event emitter at the reserved seq slot (H2+H3 fix)
  const emitEvent = buildSingleEventEmitter(
    s3, bucket,
    event?.eventsPrefix,
    event?.investigationId,
    event?.startSeq,
  );

  await runVerifierHandler({ event, s3: s3Wrapper, model: verifierModel, emitEvent });
};
