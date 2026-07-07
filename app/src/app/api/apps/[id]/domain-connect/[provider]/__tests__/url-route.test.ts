import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCheckSwitchboardFlag, mockGenerateDomainConnectSignature, mockAuthState } = vi.hoisted(
  function hoisted() {
    return {
      mockCheckSwitchboardFlag: vi.fn(),
      mockGenerateDomainConnectSignature: vi.fn(),
      mockAuthState: { jwt: 'customer-jwt-token' as string | undefined },
    };
  },
);

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, routeContext: { params: Promise<{ id: string; provider: string }> }) => {
      const mockAuthContext = {
        ...(mockAuthState.jwt !== undefined ? { jwt: mockAuthState.jwt } : {}),
        user: {
          customerId: 'customer-1',
          shopperId: 'shopper-1',
          accountId: 'account-1',
        },
      };
      return handler(request, mockAuthContext, routeContext);
    };
  },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

vi.mock('@/lib/dcc-domain-attach-client', () => ({
  DCC_API_URL_TEST: 'https://domain-attach.api.test-godaddy.com',
  DCC_API_URL_PROD: 'https://domain-attach.api.godaddy.com',
  generateDomainConnectSignature: mockGenerateDomainConnectSignature,
}));

vi.mock('@/lib/github/config', () => ({
  publicOrigin: () => 'https://local.gasket.dev-godaddy.com:8443',
}));

vi.mock('@/utils/domain', async () => {
  const actual = await vi.importActual<typeof import('@/utils/domain')>('@/utils/domain');
  return { ...actual };
});

describe('GET /api/apps/[id]/domain-connect/[provider]/url', () => {
  const APP_ID = 'app-123';
  const PARAMS = Promise.resolve({ id: APP_ID, provider: 'cloudflare' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.jwt = 'customer-jwt-token';
    // Default mock: signature generation succeeds
    mockGenerateDomainConnectSignature.mockResolvedValue({
      signature: 'mock_signature_value',
      keyName: 'domain-attach.api.godaddy.com',
    });
  });

  async function importRoute() {
    const mod = await import('../url/route');
    return mod;
  }

  function buildRequest(queryString: string): NextRequest {
    return new NextRequest(
      `https://local.gasket.dev-godaddy.com:8443/api/apps/${APP_ID}/domain-connect/cloudflare/url?${queryString}`,
    );
  }

  it('should return 401 when jwt is missing from auth context', async () => {
    mockAuthState.jwt = undefined;
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&v1=1.2.3.4&dcv=abc');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Authentication token required');
  });

  it('should return 403 when switchboard flag is disabled', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&v1=1.2.3.4&dcv=abc');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Feature not enabled');
  });

  it('should return 400 for unsupported provider', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = new NextRequest(
      `https://local.gasket.dev-godaddy.com:8443/api/apps/${APP_ID}/domain-connect/route53/url?fqdn=example.com&v1=1.2.3.4&dcv=abc`,
    );
    const unsupportedParams = Promise.resolve({ id: APP_ID, provider: 'route53' });
    const response = await GET(request, { params: unsupportedParams });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Unsupported provider');
  });

  it('should return 400 when fqdn is missing', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('v1=1.2.3.4&dcv=abc');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('fqdn, v1, and dcv');
  });

  it('should return 400 when v1 is missing', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&dcv=abc');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(400);
  });

  it('should return 400 when dcv is missing', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&v1=1.2.3.4');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(400);
  });

  it('should return a signed Domain Connect URL and set nonce cookie on success', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&v1=1.2.3.4&dcv=abc123&dkimSuffix=example_com.f86');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.url).toContain('dash.cloudflare.com/domainconnect');
    expect(body.url).toContain('domain=example.com');
    expect(body.url).toContain('services/aab/apply');
    // Check that signature parameters are included
    expect(body.url).toContain('sig=mock_signature_value');
    expect(body.url).toContain('key=domain-attach.api.godaddy.com');

    const setCookie: string | null = response.headers.get('Set-Cookie');
    expect(setCookie).toContain(`dc_nonce_${APP_ID}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');

    // Verify the customer jwt is forwarded to the signature call
    expect(mockGenerateDomainConnectSignature.mock.calls[0][1]).toBe('customer-jwt-token');

    // Verify signature was called with params in alphabetical order (matches what DCC API signs)
    const sigCallArg = mockGenerateDomainConnectSignature.mock.calls[0][0] as Record<string, string>;
    const sigCallKeys = Object.keys(sigCallArg);
    expect(sigCallKeys).toEqual([...sigCallKeys].sort());
    expect(sigCallArg).toMatchObject({ domain: 'example.com', v1: '1.2.3.4', dcv: 'abc123', dkimSuffix: 'example_com.f86' });

    // Verify URL params also appear in sorted order
    const urlObj = new URL(body.url as string);
    const urlKeys = [...urlObj.searchParams.keys()].filter((k) => !['sig', 'key'].includes(k));
    expect(urlKeys).toEqual([...urlKeys].sort());
  });

  it('should omit dkimSuffix from signed params when not provided', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&v1=1.2.3.4&dcv=abc123');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(200);

    const sigCallArg = mockGenerateDomainConnectSignature.mock.calls[0][0] as Record<string, string>;
    expect(sigCallArg).not.toHaveProperty('dkimSuffix');
  });

  it('should use aab_subdomain service for subdomains', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=shop.example.com&v1=1.2.3.4&dcv=abc123');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.url).toContain('services/aab_subdomain/apply');
  });

  it('should return 502 when signature generation fails', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    mockGenerateDomainConnectSignature.mockRejectedValue(
      new Error('Failed to generate Domain Connect signature: HTTP 500'),
    );
    const { GET } = await importRoute();
    const request: NextRequest = buildRequest('fqdn=example.com&v1=1.2.3.4&dcv=abc123');
    const response = await GET(request, { params: PARAMS });
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body.error).toBe('Failed to generate Domain Connect signature');
  });

});
