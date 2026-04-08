import { NextResponse } from 'next/server';

import { getLangfuseConfig } from '@/lib/langfuse-client';

const LANGFUSE_PROJECT_ID = process.env.LANGFUSE_PROJECT_ID;

// Cache the promise to prevent concurrent requests from hitting the Langfuse API
let projectIdPromise: Promise<string | null> | null = null;

function resolveProjectId(): Promise<string | null> {
  if (LANGFUSE_PROJECT_ID) return Promise.resolve(LANGFUSE_PROJECT_ID);
  if (projectIdPromise) return projectIdPromise;

  const lf = getLangfuseConfig();
  if (!lf) return Promise.resolve(null);

  projectIdPromise = fetch(`${lf.baseUrl}/api/public/projects`, {
    headers: { Authorization: lf.authHeader, 'Content-Type': 'application/json' },
  })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      const id = (data?.data?.[0]?.id as string | undefined) ?? null;
      if (id === null) projectIdPromise = null; // allow retry on transient failures
      return id;
    })
    .catch(() => { projectIdPromise = null; return null; });

  return projectIdPromise;
}

export async function GET() {
  const projectId = await resolveProjectId();
  return NextResponse.json({
    baseUrl: process.env.LANGFUSE_BASE_URL || null,
    projectId,
    configured: !!(process.env.LANGFUSE_BASE_URL && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY),
  });
}
