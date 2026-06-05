// Platform code-review-graph (CRG) loader for the investigator Lambda.
//
// The platform graph (agents/ + app/ + app-templates/) is no longer baked
// into the container image. Instead a scheduled GitHub Actions job
// (.github/workflows/refresh-platform-graph.yml) rebuilds it twice a day and
// uploads the resulting gzipped DB to S3 at `platform-graph/graph.db.gz` in
// the investigator state bucket. This module fetches that object at
// invocation time, gunzips it, and lays it out as
// `<root>/.code-review-graph/graph.db` so the
// code-review-graph MCP tools can be pointed at `<root>` as their `repo_root`.
//
// Design constraints (mirrors graph-setup.mjs's soft-degrade philosophy):
//   - SOFT-FAIL EVERYWHERE: a missing object, a 404, or any S3 error returns
//     `null` and NEVER throws. The agent still has the customer graph +
//     Read/Grep, so platform-graph absence must not break an investigation.
//   - ETag-cached: warm Lambda containers reuse the same /tmp file across
//     invocations. We HeadObject first; if the ETag matches the module cache
//     AND the local DB still exists, we skip the (larger) GetObject entirely.
//   - The S3 client is injectable for tests; in production the handler passes
//     the same client it already constructs.

import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

// S3 key the scheduled builder uploads to (under the investigator state
// bucket). The builder gzips the sqlite DB (~3-4x smaller: ~500MB -> ~130MB)
// so storage + the cold-start download are cheaper; we stream-gunzip it back
// to the raw `graph.db` on the way to /tmp. Exported so the handler / tests
// reference the single source.
export const PLATFORM_GRAPH_KEY = 'platform-graph/graph.db.gz';

// Where CRG expects the DB relative to the repo root it's pointed at.
const CRG_DB_RELPATH = path.join('.code-review-graph', 'graph.db');

// Module-level cache surviving warm-container reuse: the ETag we last
// downloaded and the local root we wrote it under. `null` until first fetch.
let cache = null;

/**
 * Reset the module cache. Test-only seam so cases don't leak ETag state into
 * each other. Not used in production.
 */
export function _resetPlatformGraphForTest() {
  cache = null;
}

// Local root the DB is materialized under. A test seam
// (PLATFORM_GRAPH_LOCAL_ROOT) lets the suite sandbox the otherwise-hardcoded
// /tmp path; production always resolves to /tmp/platform-graph.
function localRoot() {
  return process.env.PLATFORM_GRAPH_LOCAL_ROOT || '/tmp/platform-graph';
}

// True for the S3 "object is absent" shapes we treat as a benign miss (vs a
// real error worth surfacing). We soft-fail on EVERYTHING anyway, but this
// keeps the "missing" path distinguishable for callers/logs.
function isMissing(err) {
  if (!err) return false;
  const name = err.name || err.Code;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;
  const status = err.$metadata?.httpStatusCode;
  return status === 404;
}

/**
 * Ensure the platform graph DB is present locally and return its repo root.
 *
 * @param {object} opts
 * @param {{ send: Function }} opts.client an S3 client (real or injected fake)
 * @param {string} [opts.bucket] override bucket (defaults to STATE_BUCKET)
 * @param {Function} [opts.HeadObjectCommand] injectable command (test seam)
 * @param {Function} [opts.GetObjectCommand] injectable command (test seam)
 * @returns {Promise<string|null>} the local graph root, or null on soft-fail
 */
export async function ensurePlatformGraph(opts = {}) {
  const bucket = opts.bucket || process.env.STATE_BUCKET;
  const client = opts.client;
  // No bucket or no client → nothing to fetch. Soft-fail without an S3 call.
  if (!bucket || !client) return null;

  const root = localRoot();
  const dbPath = path.join(root, CRG_DB_RELPATH);

  // Resolve the SDK command classes. Prefer injected ones (unit tests pass
  // lightweight stand-ins so they don't need the real @aws-sdk/client-s3,
  // which is only installed in the image); otherwise lazy-import the real
  // SDK. A failed import soft-fails to null.
  let HeadObjectCommand = opts.HeadObjectCommand;
  let GetObjectCommand = opts.GetObjectCommand;
  if (!HeadObjectCommand || !GetObjectCommand) {
    try {
      const sdk = await import('@aws-sdk/client-s3');
      HeadObjectCommand = HeadObjectCommand || sdk.HeadObjectCommand;
      GetObjectCommand = GetObjectCommand || sdk.GetObjectCommand;
    } catch {
      // SDK unavailable (shouldn't happen in the image — it's a dep) → soft-fail.
      return null;
    }
  }

  try {
    // 1. HeadObject for the current ETag. Cheap relative to the full body.
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: PLATFORM_GRAPH_KEY }));
    const etag = head?.ETag ?? null;

    // 2. Warm path: same ETag as last download AND the local DB still exists →
    //    reuse it, skip the GetObject.
    if (cache && cache.etag && etag && cache.etag === etag) {
      try {
        await fs.access(dbPath);
        return cache.localPath;
      } catch {
        // Cache says we have it but the file vanished (cold container, /tmp
        // eviction) — fall through and re-download.
      }
    }

    // 3. Download the body and stream it to <root>/.code-review-graph/graph.db.
    const get = await client.send(new GetObjectCommand({ Bucket: bucket, Key: PLATFORM_GRAPH_KEY }));
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const body = get?.Body;
    if (!body) return null;
    // get.Body is a Node Readable (or async-iterable) in the Lambda runtime.
    // The S3 object is gzipped (graph.db.gz) — gunzip on the way to disk so
    // <root>/.code-review-graph/graph.db is the raw sqlite CRG expects.
    const source = body instanceof Readable ? body : Readable.from(body);
    await pipeline(source, createGunzip(), createWriteStream(dbPath));

    cache = { etag: get?.ETag ?? etag, localPath: root };
    return root;
  } catch (err) {
    // Missing object or ANY S3/stream error → soft-fail to null. The handler
    // emits a warning and continues with the customer graph + Read/Grep.
    if (!isMissing(err)) {
      // Log non-missing errors so a persistent S3/IAM problem is debuggable,
      // but still degrade rather than throw.
      console.error('[investigator] platform.graph.load.failed', {
        key: PLATFORM_GRAPH_KEY,
        error: err && err.message ? err.message : String(err),
      });
    }
    return null;
  }
}
