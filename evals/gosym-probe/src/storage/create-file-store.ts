import type { Config } from '../../config/environments/types.js';
import type { FileStore } from './file-store.js';
import { LocalFileStore } from './local-file-store.js';
import { S3FileStore } from './s3-file-store.js';

/**
 * Selects the baseline store backend. Local disk is always the default;
 * callers opt into the shared S3 bucket by passing `useS3` (wired to the
 * `--s3` flag), not via a config-level backend switch. There is no
 * "which backend?" decision for the user to make — `--s3` is a per-command
 * opt-in for sharing baselines.
 *
 * Throws when `useS3` is set but no bucket is configured, so an `--s3` run
 * fails loudly at startup rather than silently writing nowhere.
 */
export function createFileStore(config: Config, useS3: boolean = false): FileStore {
  if (!useS3) {
    return new LocalFileStore();
  }
  const s3 = config.storage?.s3;
  if (!s3?.bucket) {
    throw new Error(
      '--s3 was passed but storage.s3.bucket is not configured — '
      + 'set storage.s3.bucket in the env config or omit --s3 to use local storage.',
    );
  }
  return new S3FileStore({
    bucket: s3.bucket,
    ...(s3.prefix !== undefined && { prefix: s3.prefix }),
    ...(s3.region !== undefined && { region: s3.region }),
  });
}
