import { describe, it, expect } from 'vitest';
import { createFileStore } from '../create-file-store.js';
import { LocalFileStore } from '../local-file-store.js';
import { S3FileStore } from '../s3-file-store.js';
import type { Config } from '../../../config/environments/types.js';

function configWith(storage: Config['storage']): Config {
  return { storage } as Config;
}

describe('createFileStore', () => {
  it('defaults to LocalFileStore when useS3 is omitted', () => {
    expect(createFileStore({} as Config)).toBeInstanceOf(LocalFileStore);
  });

  it('returns LocalFileStore when useS3 is false, even with s3 config present', () => {
    const store = createFileStore(
      configWith({ s3: { bucket: 'b', prefix: 'p', region: 'us-west-2' } }),
      false,
    );
    expect(store).toBeInstanceOf(LocalFileStore);
  });

  it('returns S3FileStore when useS3 is true and a bucket is configured', () => {
    const store = createFileStore(
      configWith({ s3: { bucket: 'b', prefix: 'p', region: 'us-west-2' } }),
      true,
    );
    expect(store).toBeInstanceOf(S3FileStore);
  });

  it('throws when useS3 is true but no bucket is configured', () => {
    expect(() => createFileStore(configWith({}), true)).toThrow(
      /storage\.s3\.bucket is not configured/,
    );
  });

  it('throws when useS3 is true but storage is absent entirely', () => {
    expect(() => createFileStore({} as Config, true)).toThrow(
      /storage\.s3\.bucket is not configured/,
    );
  });
});
