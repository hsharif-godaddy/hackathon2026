import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { withApmRoute } from '@/lib/apm-context';
import { logger } from '@/lib/request-context';
import gasket from '../../../../gasket.ts';

const CDS_LOG_LEVELS: Record<string, 'error' | 'warn' | 'info'> = { error: 'error', warning: 'warn', warn: 'warn', info: 'info', debug: 'info' };

/**
 * CDS logging endpoint - forwards logs to CDS API
 *
 * @param request - The incoming request
 * @returns JSON response indicating the log was processed
 */
export const POST = withApmRoute(async (request: NextRequest) => {
  const cds = (gasket.config as any).cds;

  if (!cds || !cds.api || !cds.api.baseUrl || !cds.api.logPath) {
    return NextResponse.json({
      status: 'ok',
      error: `CDS API configuration is missing or incomplete. Logs will not be processed by CDS.`
    }, { status: 200 });
  }

  const { baseUrl, logPath } = cds.api;
  const cdsApiLogPath = `${baseUrl}${logPath}`;

  try {
    const body = await request.json();
    const serializedBody: string = JSON.stringify(body);

    const level: string = body?.level ?? 'info';
    const method = CDS_LOG_LEVELS[level] ?? 'info';
    logger[method](`cds.app.${level}`, { cdsApiLogPath, body: serializedBody });

    const response = await fetch(cdsApiLogPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serializedBody,
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      logger.error('cds.app.error.apiRejected', { cdsApiLogPath, status: response.status });
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    logger.error('cds.log.forward.failed', {
      error: error instanceof Error ? error.message : String(error),
      cdsApiLogPath
    });
    return NextResponse.json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
});

export const GET = withApmRoute(async (_request: NextRequest) => {
  return NextResponse.json({
    status: 'ok',
    message: 'CDS log endpoint',
    method: 'GET',
    timestamp: new Date().toISOString()
  }, { status: 200 });
});

