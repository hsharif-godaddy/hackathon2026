import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ParquetReader } = require('parquetjs');

/**
 * Parse a single-row feedback parquet buffer into a record matching the
 * AAB BFF's FeedbackS3Record shape (see
 * `app/src/app/api/feedback/s3-store/types.ts`).
 *
 * Buffer comes directly from S3 GetObject. Two paths:
 *
 * 1. Fast path: `ParquetReader.openBuffer(buffer)` if the installed
 *    parquetjs version exposes it (modern forks like parquetjs-lite do;
 *    pinned 0.11.2 does too — see fanout/package.json).
 *
 * 2. /tmp fallback: write the buffer to a unique temp dir and use
 *    `openFile`. Kept as a safety net in case a future version drops
 *    `openBuffer` or the install resolves to a fork without it. It IS
 *    concurrency-safe — `mkdtempSync` returns a unique directory per
 *    invocation so warm-container concurrent invokes don't collide on
 *    the same path. Lambda's /tmp is 512MB by default, multiple GB
 *    available; a single parquet row is KB-scale, so disk pressure is
 *    not a real concern. Cleanup runs in `finally` regardless of decode
 *    outcome.
 *
 * The fast path emits a one-time log at module load (handler.mjs:18 sees
 * the same console namespace) so ops can spot which mode is active in
 * CloudWatch.
 */
const HAS_OPEN_BUFFER = typeof ParquetReader.openBuffer === 'function';
console.log(JSON.stringify({
  level: 'info',
  msg: 'fanout.parquet.reader_mode',
  mode: HAS_OPEN_BUFFER ? 'openBuffer' : 'tmp_fallback',
}));

export async function parseFeedbackParquet(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('parquet buffer is empty');
  }

  if (HAS_OPEN_BUFFER) {
    const reader = await ParquetReader.openBuffer(buffer);
    const cursor = reader.getCursor();
    const row = await cursor.next();
    await reader.close();
    if (!row) throw new Error('parquet contained zero rows');
    return row;
  }

  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'fanout-parquet-'));
  const file = path.join(dir, 'in.parquet');
  writeFileSync(file, buffer);
  try {
    const reader = await ParquetReader.openFile(file);
    const cursor = reader.getCursor();
    const row = await cursor.next();
    await reader.close();
    if (!row) throw new Error('parquet contained zero rows');
    return row;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
