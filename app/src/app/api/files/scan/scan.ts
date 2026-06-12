import { logger } from '@/lib/request-context';
import gasket from '../../../../../gasket.ts';

export type ScannerResult = {
  success: true;
  status: number;
  data: {
    pass: boolean;
    fileHash?: string;
    fileSize?: number;
    fileType?: string;
    message?: string;
  };
};

export type ScannerFailure = {
  success: false;
  error: string;
};

export async function scanFile(file: string, fileName: string): Promise<ScannerResult | ScannerFailure> {
  const scannerBaseUrl: string | undefined = (gasket.config as any).onDemandScanner?.api?.baseUrl;
  if (!scannerBaseUrl) {
    logger.error('files.scan.config.missing', { message: 'onDemandScanner.api.baseUrl not configured' });
    return { error: 'config_missing', success: false };
  }

  try {
    const upstream = await fetch(`${scannerBaseUrl}/v1/perform-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, fileName }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await upstream.json() as ScannerResult['data'];
    return { status: upstream.status, data, success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('files.scan.upstream.failed', { fileName, error });
    return { error, success: false };
  }
}
