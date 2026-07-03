import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { FileStore } from './file-store.js';

export interface S3FileStoreConfig {
  bucket: string;
  /**
   * Key prefix all paths are written under (e.g. 'evals/gosym-probe'). Joined
   * to the path with a '/'; a trailing slash is tolerated.
   */
  prefix?: string;
  region?: string;
  /** Injectable for tests; defaults to a real client from the SDK chain. */
  client?: S3Client;
}

const DEFAULT_REGION = 'us-west-2';

/**
 * S3-backed {@link FileStore}. Maps the path-keyed file surface onto object
 * operations so eval baselines persist beyond an ephemeral CI worker
 * (squad task 1c.i). Run artifacts/reports are NOT routed through this seam —
 * they stay local / go to GHA artifacts. Path semantics are preserved by
 * normalizing the local
 * path separator into S3 key form and honouring the same null-on-miss contract
 * the local backend uses.
 *
 * Object stores have no directories, so `mkdir` is a no-op and `readdir` is
 * emulated via a delimited ListObjectsV2 that returns the immediate child
 * names (both object keys and common prefixes) under a path — matching
 * `fs.readdir`'s bare-name output that the callers assume.
 *
 * Credentials come from the standard AWS SDK chain (env / shared config /
 * instance role); locally use `AWS_PROFILE=airobuild-dev-private-sso`.
 */
export class S3FileStore implements FileStore {
  readonly backend = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: S3FileStoreConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ? stripTrailingSlash(config.prefix) : '';
    this.client =
      config.client
      ?? new S3Client({ region: config.region ?? DEFAULT_REGION });
  }

  async writeFile(path: string, data: string): Promise<void> {
    // Baselines are the only thing routed through this store, and they are
    // always JSON — hence the fixed ContentType.
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(path),
        Body: data,
        ContentType: 'application/json',
      }),
    );
  }

  async readFile(path: string): Promise<string | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.toKey(path) }),
      );
      const body = res.Body;
      // A 200 with no body is an anomaly (corruption/partial response), NOT a
      // miss — throw rather than coerce it to "no baseline" and risk a
      // false-green gate.
      if (body === undefined) {
        throw new Error(
          `S3 GetObject for '${this.toKey(path)}' returned no body (HTTP 200)`,
        );
      }
      // res.Body is StreamingBlobPayloadOutputTypes, which exposes
      // transformToString() on the Node runtime the harness targets.
      return await body.transformToString();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readdir(path: string): Promise<string[] | null> {
    const keyPrefix = this.toKey(path);
    const withSlash = keyPrefix === '' ? '' : `${keyPrefix}/`;
    const names = new Set<string>();
    let token: string | undefined;
    let sawAny = false;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: withSlash,
          Delimiter: '/',
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        sawAny = true;
        if (obj.Key && obj.Key !== withSlash) {
          names.add(obj.Key.slice(withSlash.length));
        }
      }
      for (const cp of res.CommonPrefixes ?? []) {
        sawAny = true;
        if (cp.Prefix) {
          names.add(stripTrailingSlash(cp.Prefix.slice(withSlash.length)));
        }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // No objects under the prefix → treat as a missing directory (null), to
    // match LocalFileStore's ENOENT-on-missing-dir behaviour.
    return sawAny ? [...names].filter((n) => n.length > 0) : null;
  }

  async mkdir(_path: string): Promise<void> {
    // No-op: S3 has no directories; keys are created on write.
  }

  locationFor(path: string): string {
    // Reuse toKey so the printed URI matches exactly where writeFile lands —
    // same prefix join, same separator collapse. Callers must not re-derive it.
    return `s3://${this.bucket}/${this.toKey(path)}`;
  }

  private toKey(path: string): string {
    const normalized = path.split(/[\\/]+/).filter(Boolean).join('/');
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function isNotFound(err: unknown): boolean {
  // Match object-absence shapes ONLY. Deliberately NOT a bare HTTP-404 check:
  // GetObject against a wrong/typo'd bucket returns NoSuchBucket (also 404),
  // and masking that as "no baseline" would silently skip the regression gate
  // (false-green). A bucket-level fault must propagate as a thrown error.
  const e = err as { name?: string; Code?: string };
  return (
    e?.name === 'NoSuchKey'
    || e?.name === 'NotFound'
    || e?.Code === 'NoSuchKey'
  );
}
