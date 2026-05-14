import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the ai-lib S2S auth
vi.mock('@airo/ai-lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
    isS2SAuthEnabled: vi.fn().mockReturnValue(true),
  };
});

// Mock logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fetch
const mockFetch = vi.fn();

describe('LogoService', () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
    originalEnv = { ...process.env };
    process.env.LOGO_API_URL = 'https://logo-agent.mvci.api.dev-godaddy.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    vi.resetModules();
  });

  it('should call POST /api/logo with correct headers and body', async () => {
    const { logoService } = await import('../LogoService.js');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'sess-123',
          logos: [
            {
              id: 'logo-1',
              transparentUrl: 'https://example.com/logo.png',
              solidUrl: 'https://example.com/logo-solid.png',
              mockupUrl: 'https://example.com/mockup.png',
            },
          ],
        }),
    });

    const result = await logoService.generateLogos({
      brandName: 'Test Brand',
      brandDescription: 'A test brand',
      style: 'flat',
      appId: 'app-test-1',
      customerId: 'cust-123',
      budgetUserId: 'budget-user-456',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://logo-agent.mvci.api.dev-godaddy.com/api/logo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-app-key': 'airo-app-builder',
          'x-app-builder-app-id': 'app-test-1',
          'x-customer-id': 'cust-123',
          'x-budget-user-id': 'budget-user-456',
          Authorization: 'Bearer mock-s2s-token',
        }),
      })
    );

    expect(result).toEqual({
      sessionId: 'sess-123',
      logos: [
        {
          id: 'logo-1',
          transparentUrl: 'https://example.com/logo.png',
          solidUrl: 'https://example.com/logo-solid.png',
          mockupUrl: 'https://example.com/mockup.png',
        },
      ],
    });
  });

  it('should always include budget headers', async () => {
    const { logoService } = await import('../LogoService.js');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'sess-456',
          logos: [],
        }),
    });

    await logoService.generateLogos({
      brandName: 'Test',
      brandDescription: 'Test',
      style: 'flat',
      appId: 'app-test-1',
      customerId: 'cust-123',
      budgetUserId: 'budget-user-abc',
    });

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['x-budget-user-id']).toBe('budget-user-abc');
  });

  it('should throw on API failure', async () => {
    const { logoService } = await import('../LogoService.js');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(
      logoService.generateLogos({
        brandName: 'Test',
        brandDescription: 'Test',
        style: 'flat',
        appId: 'app-test-1',
        customerId: 'cust-123',
        budgetUserId: 'budget-user-1',
      })
    ).rejects.toThrow('Logo API error: 500 Internal Server Error');
  });

  it('should throw on network error', async () => {
    const { logoService } = await import('../LogoService.js');

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      logoService.generateLogos({
        brandName: 'Test',
        brandDescription: 'Test',
        style: 'flat',
        appId: 'app-test-1',
        customerId: 'cust-123',
        budgetUserId: 'budget-user-1',
      })
    ).rejects.toThrow('Network error');
  });

  it('should send optional body fields when provided', async () => {
    const { logoService } = await import('../LogoService.js');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'sess-789',
          logos: [],
        }),
    });

    await logoService.generateLogos({
      brandName: 'My Cafe',
      brandDescription: 'A coffee shop',
      style: 'handmade',
      brandTagline: 'Best coffee in town',
      brandColors: 'warm earth tones',
      symbol: 'coffee cup',
      count: 2,
      appId: 'app-test-1',
      customerId: 'cust-123',
      budgetUserId: 'budget-user-1',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      brandName: 'My Cafe',
      brandDescription: 'A coffee shop',
      style: 'handmade',
      brandTagline: 'Best coffee in town',
      brandColors: 'warm earth tones',
      symbol: 'coffee cup',
      count: 2,
    });
  });

  it('should derive URL from GODADDY_API_BASE_URL when LOGO_API_URL not set', async () => {
    delete process.env.LOGO_API_URL;
    process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com';

    const { logoService } = await import('../LogoService.js');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'sess-1',
          logos: [],
        }),
    });

    await logoService.generateLogos({
      brandName: 'Test',
      brandDescription: 'Test',
      style: 'flat',
      appId: 'app-test-1',
      customerId: 'cust-123',
      budgetUserId: 'budget-user-1',
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://logo-agent.mvci.api.dev-godaddy.com/api/logo'
    );
  });

  it('should call POST /api/logo/edit with x-app-builder-app-id header', async () => {
    const { logoService } = await import('../LogoService.js');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'sess-edit-1',
          logos: [
            {
              id: 'logo-edit-1',
              transparentUrl: 'https://example.com/edited.png',
            },
          ],
        }),
    });

    const result = await logoService.editLogos({
      sourceSessionId: 'sess-source-1',
      sourceLogoId: 'logo-source-1',
      prompt: 'Make it blue',
      appId: 'app-test-edit',
      customerId: 'cust-123',
      budgetUserId: 'budget-user-edit',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://logo-agent.mvci.api.dev-godaddy.com/api/logo/edit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-app-key': 'airo-app-builder',
          'x-app-builder-app-id': 'app-test-edit',
          'x-customer-id': 'cust-123',
          'x-budget-user-id': 'budget-user-edit',
          Authorization: 'Bearer mock-s2s-token',
        }),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      sourceSessionId: 'sess-source-1',
      sourceLogoId: 'logo-source-1',
      prompt: 'Make it blue',
    });

    expect(result.sessionId).toBe('sess-edit-1');
  });
});
