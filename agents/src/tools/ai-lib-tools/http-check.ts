import { createTool, type Tool } from '@airo/ai-lib';
import { Agent } from 'undici';
import { z } from 'zod';

const tlsSkipAgent = new Agent({ connect: { rejectUnauthorized: false } });

export type HttpCheckErrorKind = 'timeout' | 'network' | 'config' | 'expectation_mismatch' | 'authentication_required' | null;

export const httpCheckAITool: Tool = createTool(
  "Verify an HTTP handler responds correctly. Evaluate both the status code and response body to confirm the handler behaves as expected. For app routes use relative paths ('/api/...'); for external URLs use absolute paths.",
  z.object({
    url: z.string().describe("App-relative path ('/api/...') or absolute URL for external reachability"),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).describe('HTTP method — MUST match the handler being verified'),
    body: z.string().optional().describe('Request body for POST/PUT/PATCH (use minimal valid JSON to avoid validation errors)'),
    headers: z.record(z.string(), z.string()).optional(),
    expectStatus: z.number().optional().describe('Expected status code for this handler'),
    expectContentType: z.string().default('application/json').describe("Expected response content-type (e.g. 'application/json', 'text/html'). Defaults to 'application/json' — set to 'text/html' for frontend/page routes."),
    timeoutMs: z.number().min(500).max(10000).default(5000),
  }),
  async (input, context) => {
    // parsedTarget is carried through so localhost normalization and the HTTPS
    // hostname check can reuse the already-parsed URL object instead of
    // re-parsing targetUrl each time.
    let parsedTarget: URL;

    if (input.url.startsWith('/')) {
      const appBaseUrl = context?.metadata?.appBaseUrl as string | undefined;
      if (!appBaseUrl) {
        return {
          ok: false,
          errorKind: 'config' as HttpCheckErrorKind,
          resolvedUrl: input.url,
          status: 0,
          latencyMs: 0,
          bodyPreview: '',
          mismatchReason: 'App base URL not available in context — use an absolute URL (e.g. http://127.0.0.1:<port>/api/...) instead of a relative path',
        };
      }
      // Use URL constructor to handle base URLs that include query params
      // (e.g. previewUrl with ?airoShareToken=...). Preserves auth tokens
      // while setting the correct pathname.
      let base: URL;
      try {
        const normalizedBase = /^https?:\/\//i.test(appBaseUrl) ? appBaseUrl : `https://${appBaseUrl}`;
        base = new URL(normalizedBase);
      } catch {
        return {
          ok: false,
          errorKind: 'config' as HttpCheckErrorKind,
          resolvedUrl: input.url,
          status: 0,
          latencyMs: 0,
          bodyPreview: '',
          mismatchReason: `App base URL in context is not a valid URL: ${appBaseUrl}`,
        };
      }
      const inputParsed = new URL(input.url, 'http://placeholder');
      base.pathname = inputParsed.pathname;
      // Merge input query params into base (preserves airoShareToken and similar
      // base URL params that are required for auth through the dev-supervisor proxy).
      for (const [key, value] of inputParsed.searchParams) {
        base.searchParams.set(key, value);
      }
      parsedTarget = base;
    } else {
      parsedTarget = new URL(input.url);
    }

    // Node fetch resolves "localhost" to ::1 (IPv6) first; if the server
    // only binds 127.0.0.1 the connection fails. Normalize to IPv4.
    if (parsedTarget.hostname === 'localhost') {
      parsedTarget.hostname = '127.0.0.1';
    }
    const targetUrl: string = parsedTarget.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    // Sentinel header lets non-idempotent endpoints (contact form, etc.)
    // detect httpCheck traffic and validate without performing side effects.
    // Scoped to the per-conversation app target (context.metadata.appBaseUrl)
    // so the header is never leaked to external or unrelated hosts.
    const { hostname } = parsedTarget;
    const appBaseUrlForSentinel = context?.metadata?.appBaseUrl as string | undefined;
    let appHostname: string | null = null;
    if (appBaseUrlForSentinel) {
      try {
        const normalized = /^https?:\/\//i.test(appBaseUrlForSentinel) ? appBaseUrlForSentinel : `https://${appBaseUrlForSentinel}`;
        appHostname = new URL(normalized).hostname;
        if (appHostname === 'localhost') appHostname = '127.0.0.1';
      } catch {
        // appBaseUrl unparseable — relative-path resolution above would have
        // already errored; for absolute-URL callers we just skip the sentinel.
      }
    }
    const sentinelHeader: Record<string, string> =
      appHostname !== null && hostname === appHostname ? { 'X-Airo-HttpCheck': 'true' } : {};

    const start = Date.now();
    try {
      const fetchOptions: RequestInit & { dispatcher?: Agent } = {
        method: input.method,
        headers: { ...sentinelHeader, ...input.headers },
        signal: controller.signal,
      };
      if (input.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(input.method)) {
        fetchOptions.body = input.body;
        const existingHeaders = input.headers ?? {};
        const hasContentType = Object.keys(existingHeaders).some(k => k.toLowerCase() === 'content-type');
        if (!hasContentType) {
          const firstChar = input.body.trimStart()[0];
          const inferredType = firstChar === '{' || firstChar === '[' ? 'application/json' : 'text/plain';
          fetchOptions.headers = { ...sentinelHeader, 'content-type': inferredType, ...existingHeaders };
        }
      }
      // Dev-supervisor proxy uses self-signed TLS certs; skip verification
      // only for known-local hostnames so external HTTPS targets are not silently
      // checked with TLS verification off.
      if (parsedTarget.protocol === 'https:') {
        const isLocal =
          hostname === '127.0.0.1' ||
          hostname === '[::1]' ||
          hostname.endsWith('.dev-godaddy.com') ||
          hostname.endsWith('.local');
        if (isLocal) {
          fetchOptions.dispatcher = tlsSkipAgent;
        }
      }

      const response = await fetch(targetUrl, fetchOptions);
      const latencyMs = Date.now() - start;

      let bodyPreview = '';
      let bodyTruncated = false;
      if (input.method !== 'HEAD') {
        const text = await response.text();
        bodyTruncated = text.length > 512;
        bodyPreview = text.slice(0, 512);
      }

      const contentType = response.headers.get('content-type') ?? '';

      const statusOk = input.expectStatus !== undefined
        ? response.status === input.expectStatus
        : response.ok; // default: require 2xx
      const contentTypeOk = contentType.includes(input.expectContentType);
      const authBlocked = input.expectStatus === undefined && (response.status === 401 || response.status === 403);
      const ok = statusOk && contentTypeOk;
      const errorKind: HttpCheckErrorKind = ok ? null
        : authBlocked ? 'authentication_required'
        : 'expectation_mismatch';
      return {
        ok,
        errorKind,
        resolvedUrl: targetUrl,
        status: response.status,
        contentType,
        latencyMs,
        bodyPreview,
        bodyTruncated,
        ...(!statusOk ? {
          mismatchReason: input.expectStatus !== undefined
            ? `Expected status ${input.expectStatus}, got ${response.status}`
            : authBlocked
            ? `Route returned ${response.status} — handler is protected and cannot be verified without credentials`
            : `Got ${response.status} — expected a 2xx response`,
        } : !contentTypeOk ? {
          mismatchReason: `Expected content-type '${input.expectContentType}', got '${contentType}'`,
        } : {}),
      };
    } catch (error: unknown) {
      const latencyMs = Date.now() - start;
      const cause = error instanceof Error && 'cause' in error ? (error.cause as Error)?.message ?? '' : '';
      const message = cause || (error instanceof Error ? error.message : String(error));
      const timedOut = controller.signal.aborted;
      return {
        ok: false,
        errorKind: (timedOut ? 'timeout' : 'network') as HttpCheckErrorKind,
        resolvedUrl: targetUrl,
        status: 0,
        latencyMs,
        bodyPreview: '',
        mismatchReason: timedOut ? `Timed out after ${input.timeoutMs}ms` : message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
);
