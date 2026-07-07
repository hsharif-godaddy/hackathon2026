import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/github/config', () => ({
  publicOrigin: () => 'https://local.gasket.dev-godaddy.com:8443',
}));

describe('GET /api/apps/[id]/domain-connect/[provider]/callback', () => {
  const APP_ID = 'app-456';
  const FQDN = 'example.com';
  const NONCE = 'test-nonce-uuid';
  const PARAMS = Promise.resolve({ id: APP_ID, provider: 'cloudflare' });

  function buildState(appId: string, fqdn: string, nonce: string): string {
    const payload: string = JSON.stringify({ appId, fqdn, nonce });
    return Buffer.from(payload).toString('base64url');
  }

  function buildRequest(queryString: string, cookieHeader?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }
    return new NextRequest(
      `https://local.gasket.dev-godaddy.com:8443/api/apps/${APP_ID}/domain-connect/cloudflare/callback?${queryString}`,
      { headers },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function importRoute() {
    const mod = await import('../callback/route');
    return mod;
  }

  it('should redirect with error status when provider returns an error', async () => {
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest(`error=access_denied&domain=${FQDN}`);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain(`/develop/${APP_ID}`);
    expect(location).toContain('domainConnect=error');
  });

  it('should redirect with error when state param is missing', async () => {
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest(`domain=${FQDN}`);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain('domainConnect=error');
  });

  it('should redirect with error when state is malformed', async () => {
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest(`state=not-valid-base64&domain=${FQDN}`);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain('domainConnect=error');
  });

  it('should redirect with error when state appId does not match route appId', async () => {
    const { GET } = await importRoute();
    const state: string = buildState('wrong-app-id', FQDN, NONCE);
    const cookie = `dc_nonce_${APP_ID}=${NONCE}`;
    const request: NextRequest = buildRequest(`state=${state}&domain=${FQDN}`, cookie);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain('domainConnect=error');
  });

  it('should redirect with error when nonce cookie is missing', async () => {
    const { GET } = await importRoute();
    const state: string = buildState(APP_ID, FQDN, NONCE);
    const request: NextRequest = buildRequest(`state=${state}&domain=${FQDN}`);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain('domainConnect=error');
  });

  it('should redirect with error when nonce does not match', async () => {
    const { GET } = await importRoute();
    const state: string = buildState(APP_ID, FQDN, NONCE);
    const cookie = `dc_nonce_${APP_ID}=wrong-nonce`;
    const request: NextRequest = buildRequest(`state=${state}&domain=${FQDN}`, cookie);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain('domainConnect=error');
  });

  it('should redirect with success when state and nonce are valid', async () => {
    const { GET } = await importRoute();
    const state: string = buildState(APP_ID, FQDN, NONCE);
    const cookie = `dc_nonce_${APP_ID}=${NONCE}`;
    const request: NextRequest = buildRequest(`state=${state}&domain=${FQDN}`, cookie);
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(307);
    const location: string = response.headers.get('location') ?? '';
    expect(location).toContain(`/develop/${APP_ID}`);
    expect(location).toContain('domainConnect=success');
    expect(location).toContain(`domain=${FQDN}`);
  });

  it('should clear the nonce cookie on success', async () => {
    const { GET } = await importRoute();
    const state: string = buildState(APP_ID, FQDN, NONCE);
    const cookie = `dc_nonce_${APP_ID}=${NONCE}`;
    const request: NextRequest = buildRequest(`state=${state}&domain=${FQDN}`, cookie);
    const response = await GET(request, { params: PARAMS });
    const setCookie: string = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`dc_nonce_${APP_ID}=`);
    expect(setCookie).toContain('Max-Age=0');
  });
});
