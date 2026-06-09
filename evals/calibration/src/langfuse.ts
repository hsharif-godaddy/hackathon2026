import { Buffer } from 'node:buffer';

export interface LangfuseCredentials {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

function authHeader(creds: LangfuseCredentials): string {
  return `Basic ${Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString('base64')}`;
}

async function request<T>(
  creds: LangfuseCredentials,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(body unavailable)');
    throw new Error(
      `Langfuse API error: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface LangfuseTrace {
  id: string;
  sessionId?: string;
  name?: string;
  timestamp?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface LangfuseObservation {
  id: string;
  traceId: string;
  type: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown> | string | null;
  startTime?: string;
  endTime?: string;
}

interface ObservationsResponse {
  data: LangfuseObservation[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface TracesResponse {
  data: LangfuseTrace[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

export async function fetchTrace(
  creds: LangfuseCredentials,
  traceId: string,
): Promise<LangfuseTrace> {
  return request<LangfuseTrace>(
    creds,
    `/api/public/traces/${encodeURIComponent(traceId)}`,
  );
}

export async function listTracesPage(
  creds: LangfuseCredentials,
  options: { sessionId: string; page: number; limit: number; orderBy?: string },
): Promise<TracesResponse> {
  const params = new URLSearchParams();
  params.set('sessionId', options.sessionId);
  params.set('page', String(options.page));
  params.set('limit', String(options.limit));
  if (options.orderBy) params.set('orderBy', options.orderBy);
  return request<TracesResponse>(creds, `/api/public/traces?${params.toString()}`);
}

export async function listTracesAll(
  creds: LangfuseCredentials,
  sessionId: string,
): Promise<LangfuseTrace[]> {
  const limit = 50;
  const first = await listTracesPage(creds, {
    sessionId,
    page: 1,
    limit,
    orderBy: 'timestamp.desc',
  });
  const out = [...first.data];
  for (let page = 2; page <= first.meta.totalPages; page++) {
    const next = await listTracesPage(creds, {
      sessionId,
      page,
      limit,
      orderBy: 'timestamp.desc',
    });
    out.push(...next.data);
  }
  return out;
}

export async function listObservationsPage(
  creds: LangfuseCredentials,
  options: { traceId: string; page: number; limit: number },
): Promise<ObservationsResponse> {
  const params = new URLSearchParams();
  params.set('traceId', options.traceId);
  params.set('page', String(options.page));
  params.set('limit', String(options.limit));
  return request<ObservationsResponse>(
    creds,
    `/api/public/observations?${params.toString()}`,
  );
}

export async function listObservationsAll(
  creds: LangfuseCredentials,
  traceId: string,
): Promise<LangfuseObservation[]> {
  const limit = 100;
  const first = await listObservationsPage(creds, { traceId, page: 1, limit });
  const out = [...first.data];
  for (let page = 2; page <= first.meta.totalPages; page++) {
    const next = await listObservationsPage(creds, { traceId, page, limit });
    out.push(...next.data);
  }
  return out;
}

