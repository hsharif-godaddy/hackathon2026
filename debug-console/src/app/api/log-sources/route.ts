import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getAllLogSources } from '@/lib/log-sources';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = withAuth(async () => {
  try {
    const sources = getAllLogSources();

    return NextResponse.json({
      sources: sources.map(source => {
        // Derive Kibana URL from ES endpoint by replacing .es. with .kb.
        let kibanaUrl: string | undefined;
        if ((source.id === 'airo-app' || source.id === 'airo-agents') && source.endpoint) {
          kibanaUrl = source.endpoint.replace('.es.', '.kb.');
        }

        return {
          id: source.id,
          name: source.name,
          description: source.description,
          kibanaUrl
        };
      })
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch log sources',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});
