import { Agent } from 'undici';

const tlsSkipAgent = new Agent({ connect: { rejectUnauthorized: false } });

const HEALTH_CHECK_TIMEOUT_MS = 3000;

export interface PreviewHealthCheckOptions {
  /** Dev-server port fallback when no preview URL is available. */
  port?: number;
  /**
   * Canonical preview base URL (may include `airoShareToken`), matching
   * `context.metadata.appBaseUrl` / `httpCheck` relative-path resolution.
   */
  appBaseUrl?: string;
  /** Optional hook when `appBaseUrl` is present but unparseable. */
  onUnparseableAppBaseUrl?: (appBaseUrl: string) => void;
}

function normalizeLocalHostname(url: URL): void {
  if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1';
  }
}

function isLocalTlsHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.dev-godaddy.com') ||
    hostname.endsWith('.local')
  );
}

type ResolvedProbe =
  | { kind: 'url'; url: string }
  | { kind: 'unparseable'; appBaseUrl: string }
  | { kind: 'none' };

function resolveHealthCheckUrl(options: PreviewHealthCheckOptions): ResolvedProbe {
  if (options.appBaseUrl) {
    try {
      const normalized = /^https?:\/\//i.test(options.appBaseUrl)
        ? options.appBaseUrl
        : `https://${options.appBaseUrl}`;
      const parsed = new URL(normalized);
      normalizeLocalHostname(parsed);
      return { kind: 'url', url: parsed.toString() };
    } catch {
      options.onUnparseableAppBaseUrl?.(options.appBaseUrl);
      if (options.port !== undefined) {
        return { kind: 'url', url: `http://127.0.0.1:${options.port}/` };
      }
      return { kind: 'unparseable', appBaseUrl: options.appBaseUrl };
    }
  }

  if (options.port !== undefined) {
    return { kind: 'url', url: `http://127.0.0.1:${options.port}/` };
  }

  return { kind: 'none' };
}

/**
 * Probe preview health the same way agent `httpCheck` reaches the app:
 * prefer the proxied preview URL (share token, TLS, hostname) and fall
 * back to bare localhost:port when no URL is available.
 *
 * Returns true when the response status is < 500, false on 5xx or network
 * error after a probe target is resolved. When no target can be resolved
 * (invalid `appBaseUrl` and no port), returns true (fail-open).
 */
export async function checkPreviewHealth(
  options: PreviewHealthCheckOptions | number
): Promise<boolean> {
  const normalized = typeof options === 'number'
    ? { port: options }
    : options;
  const resolved = resolveHealthCheckUrl(normalized);

  if (resolved.kind === 'unparseable' || resolved.kind === 'none') {
    return true;
  }

  try {
    const target = new URL(resolved.url);
    const fetchOptions: RequestInit & { dispatcher?: Agent } = {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    };
    if (target.protocol === 'https:' && isLocalTlsHost(target.hostname)) {
      fetchOptions.dispatcher = tlsSkipAgent;
    }

    const response = await fetch(resolved.url, fetchOptions);
    await response.body?.cancel();
    return response.status < 500;
  } catch {
    return false;
  }
}
