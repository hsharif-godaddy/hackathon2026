import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withApmRoute } from '@/lib/apm-context';
import { logger } from '@/lib/request-context';
import { scanFile } from './scan';
import { parseJsonSafe, readBodyCapped } from './utils';

const MAX_SCAN_BYTES = 30 * 1024 * 1024; // 30 MB cap on the JSON body (base64 overhead means ~22 MB decoded file)

export const dynamic = 'force-dynamic';

const ScanRequestSchema = z.object({
  file: z.string(),
  fileName: z.string(),
});

export const POST = withApmRoute(async (request: NextRequest) => {
  // Fast-path: skip reading any bytes when the content-length header already exceeds the cap.
  // readBodyCapped below is the authoritative enforcement for requests that omit the header.
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SCAN_BYTES) {
    return NextResponse.json({ error: 'File exceeds 30 MB scan limit' }, { status: 413 });
  }

  const rawBody = await readBodyCapped(request, MAX_SCAN_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ error: 'File exceeds 30 MB scan limit' }, { status: 413 });
  }

  const parsed = ScanRequestSchema.safeParse(parseJsonSafe(rawBody));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing required fields: file, fileName' }, { status: 400 });
  }

  const { file, fileName } = parsed.data;

  const scanResult = await scanFile(file, fileName);
  if (!scanResult) {
    return NextResponse.json({ error: 'Scan service unavailable' }, { status: 503 });
  }

  if (scanResult.status === 400) {
    return NextResponse.json({ error: 'Invalid scan request' }, { status: 400 });
  }

  if (scanResult.status === 422) {
    const message = scanResult.data.message ?? 'Malware found in file';
    logger.warn('files.scan.malware.detected', { fileName, message });
    return NextResponse.json({ pass: false, message }, { status: 422 });
  }

  if (scanResult.status === 200) {
    return NextResponse.json({
      pass: true,
      fileHash: scanResult.data.fileHash,
      fileSize: scanResult.data.fileSize,
      fileType: scanResult.data.fileType,
    }, { status: 200 });
  }

  logger.error('files.scan.upstream.unexpected', { fileName, status: scanResult.status });
  return NextResponse.json({ error: 'Scan service unavailable' }, { status: 503 });
});
