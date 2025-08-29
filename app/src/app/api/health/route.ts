// Health check endpoint for the backend API
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const detailed = searchParams.get('detailed') === 'true';

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'airo-app-builder-backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
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
      },
      features: {
        jwtValidation: true,
        secureValidation: process.env.ENABLE_SECURE_JWT_VALIDATION === 'true',
        gasketCompatibility: true
      }
    });
  }

  return NextResponse.json(health, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}
