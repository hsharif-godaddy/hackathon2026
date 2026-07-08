import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AiroAttribute } from '@/lib/mgmt-airo';
import { AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY } from '@/lib/whats-new-modal-state';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: unknown): unknown => handler,
}));

vi.mock('@/lib/mgmt-airo', async () => {
  const actual: typeof import('@/lib/mgmt-airo') = await vi.importActual('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn(),
  };
});

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface AuthContextFixture {
  jwt?: string;
  user: { customerId: string };
}

interface MockMgmtClient {
  getAttribute: ReturnType<typeof vi.fn>;
  createAttribute: ReturnType<typeof vi.fn>;
  updateAttribute: ReturnType<typeof vi.fn>;
}

function makeAttribute(value: Record<string, unknown>): AiroAttribute {
  return {
    id: 'attr-1',
    ownerType: 'user',
    ownerId: 'customer-123',
    key: AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY,
    value,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
  };
}

describe('/api/whats-new/airo-controls', () => {
  let mockClient: MockMgmtClient;
  let GET: (request: NextRequest, authContext: AuthContextFixture) => Promise<Response>;
  let PATCH: (request: NextRequest, authContext: AuthContextFixture) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));

    mockClient = {
      getAttribute: vi.fn().mockResolvedValue(null),
      createAttribute: vi.fn().mockResolvedValue(makeAttribute({})),
      updateAttribute: vi.fn().mockResolvedValue(makeAttribute({})),
    };

    const { AiroMgmtClient } = await import('@/lib/mgmt-airo');
    vi.mocked(AiroMgmtClient).mockImplementation(function mockAiroMgmtClient(): never {
      return mockClient as never;
    });

    const routeModule: typeof import('./route') = await import('./route');
    GET = routeModule.GET as typeof GET;
    PATCH = routeModule.PATCH as typeof PATCH;
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  function authContext(jwt: string | undefined = 'jwt-token'): AuthContextFixture {
    return { jwt, user: { customerId: 'customer-123' } };
  }

  it('returns empty state when the user attribute does not exist', async () => {
    const response: Response = await GET(
      new NextRequest('http://localhost/api/whats-new/airo-controls'),
      authContext()
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ desktop: { viewCount: 0 }, mobile: { viewCount: 0 } });
    expect(mockClient.getAttribute).toHaveBeenCalledWith(
      'user',
      'customer-123',
      AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY
    );
  });

  it('creates the user attribute when recording the first desktop view', async () => {
    const response: Response = await PATCH(
      new NextRequest('http://localhost/api/whats-new/airo-controls', {
        method: 'PATCH',
        body: JSON.stringify({ device: 'desktop', action: 'viewed' }),
      }),
      authContext()
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      desktop: { viewCount: 1, lastViewedAt: '2026-07-06T12:00:00.000Z' },
      mobile: { viewCount: 0 },
    });
    expect(mockClient.createAttribute).toHaveBeenCalledWith('user', 'customer-123', {
      key: AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY,
      value: body,
    });
  });

  it('updates the existing user attribute when recording mobile completion', async () => {
    mockClient.getAttribute.mockResolvedValue(
      makeAttribute({ desktop: { viewCount: 2 }, mobile: { viewCount: 1 } })
    );

    const response: Response = await PATCH(
      new NextRequest('http://localhost/api/whats-new/airo-controls', {
        method: 'PATCH',
        body: JSON.stringify({ device: 'mobile', action: 'completed' }),
      }),
      authContext()
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      desktop: { viewCount: 2 },
      mobile: { viewCount: 1, completedAt: '2026-07-06T12:00:00.000Z' },
    });
    expect(mockClient.updateAttribute).toHaveBeenCalledWith('attr-1', { value: body });
  });

  it('rejects malformed PATCH JSON', async () => {
    const response: Response = await PATCH(
      new NextRequest('http://localhost/api/whats-new/airo-controls', {
        method: 'PATCH',
        body: '{',
      }),
      authContext()
    );

    expect(response.status).toBe(400);
    expect(mockClient.getAttribute).not.toHaveBeenCalled();
    expect(mockClient.createAttribute).not.toHaveBeenCalled();
    expect(mockClient.updateAttribute).not.toHaveBeenCalled();
  });

  it('rejects invalid PATCH bodies', async () => {
    const response: Response = await PATCH(
      new NextRequest('http://localhost/api/whats-new/airo-controls', {
        method: 'PATCH',
        body: JSON.stringify({ device: 'tablet', action: 'viewed' }),
      }),
      authContext()
    );

    expect(response.status).toBe(400);
    expect(mockClient.createAttribute).not.toHaveBeenCalled();
    expect(mockClient.updateAttribute).not.toHaveBeenCalled();
  });
});
