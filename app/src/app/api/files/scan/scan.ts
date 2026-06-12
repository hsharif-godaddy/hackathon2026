import { logger } from '@/lib/request-context';
import gasket from '../../../../../gasket.ts';

export type ScannerResult = {
  status: number;
  data: {
    pass: boolean;
    fileHash?: string;
    fileSize?: number;
    fileType?: string;
    message?: string;
  };
};

export async function scanFile(file: string, fileName: string): Promise<ScannerResult | null> {
  const scannerBaseUrl: string | undefined = (gasket.config as any).onDemandScanner?.api?.baseUrl;
  if (!scannerBaseUrl) {
    logger.error('files.scan.config.missing', { message: 'onDemandScanner.api.baseUrl not configured' });
    return null;
  }

  try {
    const upstream = await fetch(`${scannerBaseUrl}/v1/perform-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, fileName }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await upstream.json() as ScannerResult['data'];
    return { status: upstream.status, data };
  } catch (err) {
    logger.error('files.scan.upstream.failed', {
      fileName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
