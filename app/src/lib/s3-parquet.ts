import { createRequire } from 'node:module';

import { S3Client } from '@aws-sdk/client-s3';

import { logger } from '@/lib/request-context';

// ---- S3 client singleton ----

let _s3Client: S3Client | null = null;
let _s3ClientInitError: string | null = null;
try {
  _s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-west-2' });
} catch (err) {
  _s3ClientInitError = err instanceof Error ? err.message : String(err);
  logger.error('s3-parquet.client_init_failed', { error: _s3ClientInitError });
}

export const s3Client = _s3Client;
export const s3ClientInitError = _s3ClientInitError;

// ---- Shared constants ----

export const APP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ---- Key / timestamp helpers ----

export function buildS3Key(tablePrefix: string, appId: string | null, now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  return `${tablePrefix}/year=${year}/month=${month}/day=${day}/hour=${hour}/appId=${appId ?? 'unknown'}/${now.getTime()}.parquet`;
}

export function formatUtcTs(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

// ---- parquetjs loader (CJS interop) ----

const require = createRequire(import.meta.url);
export const { ParquetSchema, ParquetWriter } = require('parquetjs') as {
  ParquetSchema: new (schema: Record<string, unknown>) => {
    fields: unknown;
    fieldList: unknown[];
  };
  ParquetWriter: {
    openStream(
      schema: InstanceType<typeof ParquetSchema>,
      outputStream: {
        write: (buf: Buffer, cb: (err?: Error | null) => void) => void;
        close: (cb?: (err?: Error | null) => void) => void;
      },
      opts: { useDataPageV2?: boolean },
    ): Promise<{
      appendRow: (row: Record<string, unknown>) => Promise<void>;
      close: () => Promise<void>;
    }>;
  };
};

export type ParquetSchemaInstance = InstanceType<typeof ParquetSchema>;

// ---- Generic single-row encoder ----

export async function encodeParquet(
  schema: ParquetSchemaInstance,
  row: Record<string, unknown>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const outputStream = {
    write(buf: Buffer, cb: (err?: Error | null) => void) {
      try {
        chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as Parameters<typeof Buffer.from>[0]));
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
    close(cb?: (err?: Error | null) => void) {
      cb?.();
    },
  };

  const writer = await ParquetWriter.openStream(schema, outputStream, { useDataPageV2: false });
  try {
    await writer.appendRow(row);
  } finally {
    await writer.close();
  }
  return Buffer.concat(chunks);
}
