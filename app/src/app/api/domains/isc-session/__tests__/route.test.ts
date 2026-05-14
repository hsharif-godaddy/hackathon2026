/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCheckSwitchboardFlag } = vi.hoisted(() => ({
  mockCheckSwitchboardFlag: vi.fn(),
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return (request: NextRequest) =>
      handler(request, {
        user: { customerId: 'test-customer-123' },
        isAuthenticated: true,
      });
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

import { POST } from '../route';

function createRequest(
  body: Record<string, unknown>,
  host = 'airo-builder.test-godaddy.com'
): NextRequest {
  return new NextRequest(`https://${host}/api/domains/isc-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host,
    },
    body: JSON.stringify(body),
  });
}

const originalFetch = global.fetch;

describe('POST /api/domains/isc-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSwitchboardFlag.mockResolvedValue(true);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns 403 when the Switchboard flag is disabled', async () => {
    mockCheckSwitchboardFlag.mockResolvedValueOnce(false);
    const response = await POST(createRequest({ isc: 'GDWELCOME' }));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/disabled|not enabled/i);
  });

  it('returns 400 when isc is missing', async () => {
    const response = await POST(createRequest({}));
    expect(response.status).toBe(400);
  });

  it('returns 400 when isc is not a string', async () => {
    const response = await POST(createRequest({ isc: 123 }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when isc is not on the allowlist', async () => {
    const response = await POST(createRequest({ isc: 'FAKECODE' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when the host does not resolve to a known env', async () => {
    const response = await POST(
      createRequest({ isc: 'GDWELCOME' }, 'evil.example.com')
    );
    expect(response.status).toBe(400);
  });

  it('fetches the FOS root with the isc param and forwards actpro Set-Cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: new Headers([
          ['set-cookie', 'actpro=ENCRYPTED_BLOB; Domain=test-godaddy.com; Path=/; Secure'],
          ['set-cookie', 'isc=GDWELCOME; Domain=test-godaddy.com; Path=/; Secure'],
        ]),
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(createRequest({ isc: 'GDWELCOME' }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://www.test-godaddy.com/?isc=GDWELCOME');

    const forwarded = response.headers.get('set-cookie') || '';
    expect(forwarded).toContain('actpro=ENCRYPTED_BLOB');
    expect(forwarded).toContain('Domain=test-godaddy.com');
    expect(forwarded).toContain('Path=/');
    expect(forwarded).toContain('Secure');
    expect(forwarded).toContain('HttpOnly');
    expect(forwarded).toContain('SameSite=Lax');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('normalizes a lowercase isc before calling upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: new Headers([
          ['set-cookie', 'actpro=XYZ; Domain=test-godaddy.com; Path=/; Secure'],
        ]),
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(createRequest({ isc: 'gdwelcome' }));

    expect(response.status).toBe(200);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://www.test-godaddy.com/?isc=GDWELCOME');
  });

  it('resolves prod host to www.godaddy.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: new Headers([
          ['set-cookie', 'actpro=PROD_BLOB; Domain=godaddy.com; Path=/; Secure'],
        ]),
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(
      createRequest({ isc: 'GDWELCOME' }, 'airo-builder.godaddy.com')
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.godaddy.com/?isc=GDWELCOME');
  });

  it('returns 502 when upstream response has no actpro cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: new Headers([
          ['set-cookie', 'unrelated=value; Path=/'],
        ]),
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(createRequest({ isc: 'GDWELCOME' }));
    expect(response.status).toBe(502);
  });

  it('returns 502 when upstream fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(createRequest({ isc: 'GDWELCOME' }));
    expect(response.status).toBe(502);
  });
});
