import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logger } from '@/lib/request-context';
import gasket from '../../../../gasket.ts';

/**
 * CDS logging endpoint - forwards logs to CDS API
 * 
 * @param request - The incoming request
 * @returns JSON response indicating the log was processed
 */
export async function POST(request: NextRequest) {
  const cds = (gasket.config as any).cds;

 // TODO: Add a check to see if the log has been processed by CDS. If not, log an error, but still return a 200
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
    
    await fetch(cdsApiLogPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });

    // TODO: Add a check to see if the log has been processed by CDS. If not, log an error, but still return a 200
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
}

export async function GET(_request: NextRequest) {  
  return NextResponse.json({ 
    status: 'ok', 
    message: 'CDS log endpoint',
    method: 'GET',
    timestamp: new Date().toISOString()
  }, { status: 200 })
}

