// SERVER-ONLY: reads EB_LANGFUSE_BASE_URL and EB_LANGFUSE_* keys. Do not import from client components.

import { Buffer } from 'node:buffer';

import { logger } from '@/lib/logger';

export function getLangfuseAnalyticsConfig(): {
  baseUrl: string;
  authHeader: string;
  uiBaseUrl: string;
} | null {
  const base = process.env.EB_LANGFUSE_BASE_URL?.replace(/\/$/, '') ?? null;
  const publicCredential = process.env.EB_LANGFUSE_PUBLIC_KEY?.trim() || null;
  const secret = process.env.EB_LANGFUSE_SECRET_KEY?.trim() || null;
  const authHeader =
    publicCredential && secret
      ? `Basic ${Buffer.from(`${publicCredential}:${secret}`).toString('base64')}`
      : null;
  if (!base || !authHeader) {
    logger.warn('langfuse.analytics.config.missing', {
      hasBase: Boolean(base),
      hasCredentials: Boolean(publicCredential && secret),
    });
    return null;
  }
  return {
    baseUrl: base,
    authHeader,
    uiBaseUrl: base,
  };
}

export function traceUrl(projectId: string, traceId: string): string | null {
  const c = getLangfuseAnalyticsConfig();
  if (!c || !projectId || !traceId) return null;
  return `${c.uiBaseUrl}/project/${projectId}/traces/${traceId}`;
}
