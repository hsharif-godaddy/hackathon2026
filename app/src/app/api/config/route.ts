import { NextResponse } from 'next/server';

import { withApmRoute } from '@/lib/apm-context';
import { getGasketConfig } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

// Force dynamic rendering to ensure runtime environment variables are used
export const dynamic = 'force-dynamic';

export const GET = withApmRoute(async (_request) => {
  try {
    const config = await getGasketConfig();

    return NextResponse.json(config, {
      headers: {
        // Cache for 5 minutes to avoid excessive requests
        'Cache-Control': 'public, max-age=300'
      },
    });
  } catch (error) {
    logger.error('api.config.get.error', {
      message: 'Failed to fetch server config',
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
});
