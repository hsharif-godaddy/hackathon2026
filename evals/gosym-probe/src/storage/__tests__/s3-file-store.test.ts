import { describe, it, expect } from 'vitest';
import {
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { S3FileStore } from '../s3-file-store.js';

/**
 * Fake S3 backed by an in-memory key→value map. `send` dispatches on the
 * command type, mirroring just enough of PutObject / GetObject /
 * ListObjectsV2 (with delimiter + pagination) for the FileStore contract.
 */
class FakeS3 {
  readonly objects = new Map<string, string>();
  readonly contentTypes = new Map<string, string>();
  pageSize = Infinity;

  /** When set, GetObject throws this instead of its normal behaviour. */
  getError?: unknown;
  /** When set, GetObject returns a 200 with this (e.g. undefined) Body. */
  forceBody?: { transformToString: () => Promise<string> } | undefined;
  forceBodyActive = false;

  async send(command: any): Promise<any> {
    if (command instanceof PutObjectCommand) {
      this.objects.set(
        command.input.Key as string,
        command.input.Body as string,
      );
      this.contentTypes.set(
        command.input.Key as string,
        command.input.ContentType as string,
      );
      return {};
    }
    if (command instanceof GetObjectCommand) {
      if (this.getError !== undefined) throw this.getError;
      const key = command.input.Key as string;
      if (this.forceBodyActive) return { Body: this.forceBody };
      if (!this.objects.has(key)) {
        const err = new Error('NoSuchKey') as Error & { name: string };
        err.name = 'NoSuchKey';
        throw err;
      }
      const text = this.objects.get(key)!;
      return { Body: { transformToString: async () => text } };
    }
    if (command instanceof ListObjectsV2Command) {
      return this.list(command.input);
    }
    throw new Error(`unexpected command: ${command?.constructor?.name}`);
  }

  private list(input: any): any {
    const prefix = (input.Prefix as string) ?? '';
    const delimiter = input.Delimiter as string | undefined;
    const matching = [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();

    // Build a single ordered stream of entries (files → Contents, sub-dirs →
    // CommonPrefixes), then paginate ACROSS it — so common prefixes can land on
    // page 2+, matching real S3 and exercising the store's cross-page Set dedup.
    const entries: ({ kind: 'content'; key: string } | { kind: 'prefix'; value: string })[] = [];
    const seenPrefix = new Set<string>();
    for (const key of matching) {
      const rest = key.slice(prefix.length);
      const slash = delimiter ? rest.indexOf(delimiter) : -1;
      if (slash === -1) {
        entries.push({ kind: 'content', key });
      } else {
        const cp = prefix + rest.slice(0, slash + 1);
        if (!seenPrefix.has(cp)) {
          seenPrefix.add(cp);
          entries.push({ kind: 'prefix', value: cp });
        }
      }
    }

    const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
    const page = entries.slice(start, start + this.pageSize);
    const nextStart = start + page.length;
    const truncated = nextStart < entries.length;

    return {
      Contents: page.filter((e) => e.kind === 'content').map((e) => ({ Key: (e as { key: string }).key })),
      CommonPrefixes: page
        .filter((e) => e.kind === 'prefix')
        .map((e) => ({ Prefix: (e as { value: string }).value })),
      IsTruncated: truncated,
      NextContinuationToken: truncated ? String(nextStart) : undefined,
    };
  }
}

function makeStore(fake: FakeS3, prefix?: string): S3FileStore {
  return new S3FileStore({
    bucket: 'test-bucket',
    ...(prefix !== undefined && { prefix }),
    client: fake as unknown as S3Client,
  });
}

describe('S3FileStore', () => {
  it('round-trips write then read', async () => {
    const fake = new FakeS3();
    const store = makeStore(fake, 'evals/gosym-probe');
    await store.writeFile('baselines/demo/a.json', '{"x":1}');

    expect(fake.objects.has('evals/gosym-probe/baselines/demo/a.json')).toBe(true);
    expect(await store.readFile('baselines/demo/a.json')).toBe('{"x":1}');
  });

  it('returns null reading a missing key (NoSuchKey) instead of throwing', async () => {
    const store = makeStore(new FakeS3());
    expect(await store.readFile('baselines/demo/missing.json')).toBeNull();
  });

  it('returns null listing a prefix with no objects', async () => {
    const store = makeStore(new FakeS3(), 'p');
    expect(await store.readdir('baselines/empty')).toBeNull();
  });

  it('readdir returns immediate child names (files and sub-dirs), not full keys', async () => {
    const fake = new FakeS3();
    const store = makeStore(fake);
    await store.writeFile('baselines/demo/one.json', '1');
    await store.writeFile('baselines/demo/two.json', '2');
    await store.writeFile('baselines/demo/trials/0/x.json', 'deep');

    const names = await store.readdir('baselines/demo');
    expect(names?.sort()).toEqual(['one.json', 'trials', 'two.json']);
  });

  it('readdir paginates a truncated listing', async () => {
    const fake = new FakeS3();
    fake.pageSize = 2;
    const store = makeStore(fake);
    for (let i = 0; i < 5; i++) {
      await store.writeFile(`baselines/demo/f${i}.json`, String(i));
    }
    const names = await store.readdir('baselines/demo');
    expect(names?.sort()).toEqual([
      'f0.json', 'f1.json', 'f2.json', 'f3.json', 'f4.json',
    ]);
  });

  it('mkdir is a no-op (no object created)', async () => {
    const fake = new FakeS3();
    const store = makeStore(fake);
    await store.mkdir('baselines/demo');
    expect(fake.objects.size).toBe(0);
  });

  it('honours the prefix in keys without a leading or doubled slash', async () => {
    const fake = new FakeS3();
    const store = makeStore(fake, 'evals/gosym-probe/');
    await store.writeFile('baselines/demo/a.json', 'x');
    const keys = [...fake.objects.keys()];
    expect(keys).toEqual(['evals/gosym-probe/baselines/demo/a.json']);
  });

  it('collects CommonPrefixes that arrive on a later page (cross-page dedup)', async () => {
    const fake = new FakeS3();
    fake.pageSize = 1; // force files and sub-dirs onto separate pages
    const store = makeStore(fake);
    await store.writeFile('baselines/demo/a.json', '1');
    await store.writeFile('baselines/demo/sub/deep.json', 'd');
    await store.writeFile('baselines/demo/b.json', '2');

    const names = await store.readdir('baselines/demo');
    expect(names?.sort()).toEqual(['a.json', 'b.json', 'sub']);
  });

  it('rethrows a non-not-found error (e.g. AccessDenied) instead of nulling it', async () => {
    const fake = new FakeS3();
    const denied = new Error('AccessDenied') as Error & { name: string };
    denied.name = 'AccessDenied';
    fake.getError = denied;
    const store = makeStore(fake);
    await expect(store.readFile('baselines/demo/a.json')).rejects.toThrow(/AccessDenied/);
  });

  it('rethrows a NoSuchBucket (404) rather than masking it as a missing baseline', async () => {
    const fake = new FakeS3();
    const noBucket = new Error('NoSuchBucket') as Error & {
      name: string;
      $metadata: { httpStatusCode: number };
    };
    noBucket.name = 'NoSuchBucket';
    noBucket.$metadata = { httpStatusCode: 404 };
    fake.getError = noBucket;
    const store = makeStore(fake);
    // A wrong bucket must surface loudly — masking it would silently skip the
    // regression gate (false-green).
    await expect(store.readFile('baselines/demo/a.json')).rejects.toThrow(/NoSuchBucket/);
  });

  it('throws on an anomalous 200 with no Body rather than returning null', async () => {
    const fake = new FakeS3();
    fake.forceBodyActive = true;
    fake.forceBody = undefined;
    const store = makeStore(fake);
    await expect(store.readFile('baselines/demo/a.json')).rejects.toThrow(/no body/i);
  });

  it('writes baselines with an application/json ContentType', async () => {
    const fake = new FakeS3();
    const store = makeStore(fake);
    await store.writeFile('baselines/demo/a.json', '{"x":1}');
    expect(fake.contentTypes.get('baselines/demo/a.json')).toBe('application/json');
  });

  it('reports the s3 backend label', () => {
    expect(makeStore(new FakeS3()).backend).toBe('s3');
  });

  it('locationFor returns an s3:// URI whose key matches where writeFile lands', async () => {
    const fake = new FakeS3();
    const store = makeStore(fake, 'evals/gosym-probe');
    const path = 'baselines/demo/ts_run.json';

    await store.writeFile(path, '{"x":1}');
    // The printed location's key must equal the actual object key (no drift
    // between the CLI's reported destination and toKey's real join).
    const writtenKey = [...fake.objects.keys()][0];
    expect(store.locationFor(path)).toBe(`s3://test-bucket/${writtenKey}`);
    expect(store.locationFor(path)).toBe(
      's3://test-bucket/evals/gosym-probe/baselines/demo/ts_run.json',
    );
  });

  it('locationFor collapses redundant separators the same way toKey does', () => {
    const store = makeStore(new FakeS3(), 'evals/gosym-probe');
    expect(store.locationFor('baselines//demo/a.json')).toBe(
      's3://test-bucket/evals/gosym-probe/baselines/demo/a.json',
    );
  });
});
