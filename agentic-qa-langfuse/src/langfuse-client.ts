export interface LangfuseCredentials {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface LangfuseTrace {
  id: string;
  sessionId?: string;
  name?: string;
  timestamp: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

export interface LangfuseObservation {
  id: string;
  traceId: string;
  name?: string;
  type: string;
  metadata?: Record<string, unknown> | string | null;
}

interface TracesResponse {
  data: LangfuseTrace[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface ObservationsResponse {
  data: LangfuseObservation[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

export interface CreateScoreParams {
  traceId?: string;
  sessionId?: string;
  observationId?: string;
  name: string;
  value: string | number;
  dataType: 'CATEGORICAL' | 'NUMERIC';
  comment?: string;
  id?: string;
}

function authHeader(creds: LangfuseCredentials): string {
  return `Basic ${Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString('base64')}`;
}

async function request<T>(creds: LangfuseCredentials, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      'Authorization': authHeader(creds),
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(body unavailable)');
    throw new Error(`Langfuse API error: ${response.status} ${response.statusText} - ${body}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function listTraces(
  creds: LangfuseCredentials,
  options: {
    sessionId?: string;
    fromTimestamp?: string;
    environment?: string;
    page?: number;
    limit?: number;
  }
): Promise<TracesResponse> {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 50));
  if (options.sessionId) params.set('sessionId', options.sessionId);
  if (options.fromTimestamp) params.set('fromTimestamp', options.fromTimestamp);
  if (options.environment) params.set('environment', options.environment);

  return request<TracesResponse>(creds, `/api/public/traces?${params}`);
}

export async function listObservations(
  creds: LangfuseCredentials,
  options: {
    traceId: string;
    type?: string;
    page?: number;
    limit?: number;
  }
): Promise<ObservationsResponse> {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 100));
  params.set('traceId', options.traceId);
  if (options.type) params.set('type', options.type);

  return request<ObservationsResponse>(creds, `/api/public/observations?${params}`);
}

export async function createScore(
  creds: LangfuseCredentials,
  params: CreateScoreParams
): Promise<void> {
  await request<unknown>(creds, '/api/public/scores', {
    method: 'POST',
    body: JSON.stringify({
      id: params.id,
      traceId: params.traceId,
      sessionId: params.sessionId,
      observationId: params.observationId,
      name: params.name,
      value: params.value,
      dataType: params.dataType,
      comment: params.comment,
    }),
  });
}
