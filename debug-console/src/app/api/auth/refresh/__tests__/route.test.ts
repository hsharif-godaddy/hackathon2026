import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();
const extractTokenFromRequestMock = vi.fn();

vi.mock('@/lib/gd-auth-service', () => ({
    gdAuthService: {
        authenticate: (...args: unknown[]) => authenticateMock(...args),
        extractTokenFromRequest: (...args: unknown[]) => extractTokenFromRequestMock(...args),
    },
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    },
}));

function makeRequest(host = 'console.godaddy.com'): NextRequest {
    return new NextRequest(new URL('https://console.godaddy.com/api/auth/refresh'), {
        method: 'POST',
        headers: { host },
    });
}

/**
 * Build a minimal Headers-like object that exposes getSetCookie, since
 * undici's Headers.getSetCookie may not be present in every test runtime.
 */
function buildSsoResponse(opts: {
    status: number;
    setCookies?: string[] | null;
}): Response {
    const headers = new Headers();
    const res = new Response(null, { status: opts.status, headers });
    if (opts.setCookies === null) {
        Object.defineProperty(res.headers, 'getSetCookie', { value: undefined });
    } else if (opts.setCookies !== undefined) {
        Object.defineProperty(res.headers, 'getSetCookie', {
            value: () => opts.setCookies,
        });
    } else {
        Object.defineProperty(res.headers, 'getSetCookie', { value: () => [] });
    }
    return res;
}

describe('auth/refresh route POST', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        extractTokenFromRequestMock.mockReturnValue('jwt-token');
        authenticateMock.mockResolvedValue({ valid: true });
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.resetModules();
    });

    it('returns 401 when no token is present', async () => {
        extractTokenFromRequestMock.mockReturnValue(null);
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.ok).toBe(false);
    });

    it('returns 401 when token fails local validation (without contacting SSO)', async () => {
        authenticateMock.mockResolvedValue({ valid: false, reason: 'Bad signature' });
        global.fetch = vi.fn();
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.reason).toBe('Bad signature');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('targets the prod SSO host for prod fqdns', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            buildSsoResponse({ status: 200, setCookies: ['auth_jomax=new; Path=/; Secure'] })
        );
        global.fetch = fetchMock;
        const { POST } = await import('../route');
        const res = await POST(makeRequest('console.godaddy.com'));
        expect(res.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe('https://sso.godaddy.com/v1/api/token/ui_heartbeat');
    });

    it('targets the test SSO host for dev fqdns', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            buildSsoResponse({ status: 200, setCookies: ['auth_jomax=new; Path=/; Secure'] })
        );
        global.fetch = fetchMock;
        const { POST } = await import('../route');
        const res = await POST(makeRequest('local.gasket.dev-godaddy.com:8443'));
        expect(res.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe('https://sso.test-godaddy.com/v1/api/token/ui_heartbeat');
    });

    it('returns 401 when SSO heartbeat returns 401', async () => {
        global.fetch = vi.fn().mockResolvedValue(buildSsoResponse({ status: 401 }));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.reason).toMatch(/SSO heartbeat returned 401/);
    });

    it('returns 401 when SSO heartbeat returns 403', async () => {
        global.fetch = vi.fn().mockResolvedValue(buildSsoResponse({ status: 403 }));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(401);
    });

    it('returns 502 when SSO heartbeat returns a 5xx error', async () => {
        global.fetch = vi.fn().mockResolvedValue(buildSsoResponse({ status: 503 }));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.reason).toMatch(/SSO heartbeat returned 503/);
    });

    it('returns 500 when runtime Headers API is missing getSetCookie', async () => {
        global.fetch = vi.fn().mockResolvedValue(buildSsoResponse({ status: 200, setCookies: null }));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.reason).toMatch(/cannot forward refreshed cookie/);
    });

    it('returns 401 (ghost session) when SSO returns 200 with no Set-Cookie', async () => {
        global.fetch = vi.fn().mockResolvedValue(buildSsoResponse({ status: 200, setCookies: [] }));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.reason).toMatch(/no Set-Cookie/);
    });

    it('forwards Set-Cookie headers to the client on success', async () => {
        const cookies = [
            'auth_jomax=new-jwt; Path=/; Secure; HttpOnly',
            'auth_idp=other; Path=/; Secure',
        ];
        global.fetch = vi.fn().mockResolvedValue(buildSsoResponse({ status: 200, setCookies: cookies }));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);

        const forwarded = (typeof res.headers.getSetCookie === 'function')
            ? res.headers.getSetCookie()
            : [res.headers.get('set-cookie')!];
        expect(forwarded.length).toBeGreaterThanOrEqual(1);
        const joined = forwarded.join('\n');
        expect(joined).toContain('auth_jomax=new-jwt');
        expect(joined).toContain('auth_idp=other');
    });

    it('sends the token as `sso-jwt` Authorization with realm=jomax body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            buildSsoResponse({ status: 200, setCookies: ['auth_jomax=new; Path=/; Secure'] })
        );
        global.fetch = fetchMock;
        const { POST } = await import('../route');
        await POST(makeRequest());
        const [, init] = fetchMock.mock.calls[0];
        expect(init.method).toBe('POST');
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('sso-jwt jwt-token');
        expect(headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body as string)).toEqual({ realm: 'jomax' });
    });

    it('returns 502 when fetch throws', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
        const { POST } = await import('../route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.reason).toMatch(/SSO heartbeat request failed/);
    });
});
