import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const mockCreateSite = vi.fn();

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: any) => {
      return handler(request, {
        jwt: 'test-jwt',
        user: { accountId: 'acc-1', customerId: 'cust-1', email: 'test@test.com' }
      });
    };
  },
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: vi.fn(),
  setSpanAppId: vi.fn(),
  setSpanJobId: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({ createSite: mockCreateSite })
}));

vi.mock('@/lib/translations/server-intl', () => ({
  detectLocale: vi.fn().mockResolvedValue('en-US')
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/sites/quick-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/sites/quick-create ITC validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSite.mockResolvedValue({
      success: true, siteId: 'app-1', name: 'Test', status: 'active',
      type: 'job', account_id: 'acc-1',
    });
  });

  it('passes valid ITC to createSite', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'summer_2026' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.objectContaining({ itc: 'summer_2026' })
    );
  });

  it('drops ITC exceeding 128 chars', async () => {
    const { POST } = await import('../route');
    const longItc = 'a'.repeat(129);
    await POST(makeRequest({ initialPrompt: 'test', itc: longItc }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops non-string ITC', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 12345 }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops empty string ITC', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: '' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops ITC with invalid characters', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: '../../etc/passwd' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('drops ITC with spaces', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test', itc: 'campaign with spaces' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });

  it('omits ITC when not provided', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest({ initialPrompt: 'test' }));

    expect(mockCreateSite).toHaveBeenCalledWith(
      expect.not.objectContaining({ itc: expect.anything() })
    );
  });
});
