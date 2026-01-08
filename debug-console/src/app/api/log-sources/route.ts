import { NextResponse } from 'next/server';

import { getAllLogSources } from '@/lib/log-sources';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const sources = getAllLogSources();

    return NextResponse.json({
      sources: sources.map(source => ({
        id: source.id,
        name: source.name,
        description: source.description
      }))
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
}

