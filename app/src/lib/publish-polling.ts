import { logger } from '@/lib/request-context';

export type TerminalPhase = 'deployed' | 'failed' | 'timeout' | 'aborted';

export interface PublishTerminalResult {
  phase: TerminalPhase;
  commitHash?: string;
  version?: string;
  error?: string;
  logs?: string[];
  buildTimeoutSeconds?: number;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  refreshToken?: () => Promise<{ token: string }>;
}

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;

function toTerminalResult(data: Record<string, unknown>): PublishTerminalResult | null {
  const phase = data.phase as string | undefined;
  if (phase === 'deployed') {
    return { phase: 'deployed', commitHash: data.commitHash as string | undefined, version: data.version as string | undefined };
  }
  if (phase === 'failed') {
    return { phase: 'failed', error: data.error as string | undefined, logs: data.logs as string[] | undefined, buildTimeoutSeconds: data.buildTimeoutSeconds as number | undefined };
  }
  // Supervisor fallback: no job in registry, derive state from container health
  if (!phase && data.source === 'supervisor') {
    const health = data.health as { status?: string } | undefined;
    const process = data.process as { state?: string } | undefined;
    if (health?.status === 'healthy' && process?.state === 'running') {
      return null;
    }
    if (process?.state === 'starting') {
      return null;
    }
    return { phase: 'failed', error: 'Publish container is not healthy' };
  }
  // No phase and no supervisor source means job was evicted (agent restart)
  if (!phase) {
    return { phase: 'failed', error: 'Publish job not found (agent may have restarted)' };
  }
  return null;
}

export async function pollPublishStatus(
  agentUrl: string,
  appId: string,
  token: string,
  options?: PollOptions,
): Promise<PublishTerminalResult> {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options?.signal;
  const refreshToken = options?.refreshToken;

  let currentToken = token;
  let authRetries = 0;
  let pollCount = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 10;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const statusUrl = `${agentUrl}/apps/${appId}/publish/status`;

  while (Date.now() < deadline) {
    if (signal?.aborted) return { phase: 'aborted' };

    try {
      const response = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${currentToken}` },
        signal,
      });

      if (response.status === 401 && refreshToken && authRetries < 3) {
        authRetries++;
        currentToken = (await refreshToken()).token;
        await sleep(intervalMs, signal);
        continue;
      }

      if (!response.ok) {
        consecutiveErrors++;
        logger.warn('publish-polling.fetch-error', { appId, status: response.status, consecutiveErrors });
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          logger.error('publish-polling.circuit-breaker', { appId, consecutiveErrors });
          return { phase: 'failed', error: `Publish status unavailable after ${consecutiveErrors} consecutive errors` };
        }
        await sleep(intervalMs, signal);
        continue;
      }

      consecutiveErrors = 0;
      authRetries = 0;
      pollCount++;
      const data: Record<string, unknown> = await response.json();
      const terminal = toTerminalResult(data);
      if (terminal) {
        logger.info('publish-polling.resolved', { appId, phase: terminal.phase, pollCount, elapsedMs: Date.now() - startedAt });
        return terminal;
      }
    } catch (err) {
      if (signal?.aborted) return { phase: 'aborted' };
      consecutiveErrors++;
      logger.warn('publish-polling.network-error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
        consecutiveErrors,
      });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error('publish-polling.circuit-breaker', { appId, consecutiveErrors });
        return { phase: 'failed', error: `Publish status unavailable after ${consecutiveErrors} consecutive errors` };
      }
    }

    await sleep(intervalMs, signal);
  }

  return { phase: 'timeout' };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(function delaySleep(resolve) {
    if (signal?.aborted) {
      resolve();
      return;
    }

    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }

    const timer = setTimeout(function onTimeout() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
