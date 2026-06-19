/** Strip optional `/apps/{appId}` suffix — media routes live at `/media/{appId}/...`. */
export function resolveBaseAgentUrl(agentUrl: string, appId: string): string {
  return agentUrl.replace(`/apps/${appId}`, '');
}

export class MediaFetchHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MediaFetchHttpError';
    this.status = status;
  }
}

export function isRetriableMediaFetchStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504;
}

async function readMediaFetchErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return 'Unknown error';
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error || text;
  } catch {
    return text;
  }
}

export async function throwIfMediaFetchNotOk(response: Response, resourceLabel: string): Promise<void> {
  if (response.ok) return;

  const bodyMessage = await readMediaFetchErrorMessage(response);
  throw new MediaFetchHttpError(
    bodyMessage !== 'Unknown error' ? bodyMessage : `Failed to fetch ${resourceLabel}: ${response.status}`,
    response.status,
  );
}

export function isTransientMediaFetchError(error: unknown): boolean {
  if (error instanceof MediaFetchHttpError) {
    return isRetriableMediaFetchStatus(error.status);
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch')
    || message.includes('agent url not available')
    || message.includes('agent is not ready')
    || message.includes('network')
    || message.includes('load failed')
  );
}

export const MEDIA_FETCH_MAX_RETRIES = 4;

export function mediaFetchRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MEDIA_FETCH_MAX_RETRIES && isTransientMediaFetchError(error);
}

export function mediaFetchRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}
