import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const detailed = searchParams.get('detailed') === 'true';

  const health: Record<string, unknown> = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'debug-console',
    package_version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'production',
    version: process.env.KATANA_ARTIFACT_VERSION?.substring(0, 7) || 'unknown'
  };

  if (detailed) {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    Object.assign(health, {
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        used: Math.round(memory.heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(memory.heapTotal / 1024 / 1024) + ' MB',
        rss: Math.round(memory.rss / 1024 / 1024) + ' MB'
      }
    });
  }

  return NextResponse.json(health, {
    headers: {
      'Cache-Control': 'no-cache'
    }
  });
}
