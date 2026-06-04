import express, { Express } from 'express';
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { validateAppOwnership } from '../../middleware/app-ownership.js';
import type { AuthenticatedRequest, ProductType } from '../../middleware/jwt-auth.js';

// Mock memory store
const mockMemoryStore = {
  get: vi.fn(),
};

// IMPORTANT: Mocks must be set up BEFORE importing the route module
// because the route calls getKvMemoryStore() at module load time
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: vi.fn(function () { return mockMemoryStore; }),
}));

vi.mock('../../middleware/app-ownership.js');

// Import route AFTER mocks are set up
const { default: inboxAccountRouter } = await import('../inbox-account.js');

describe('GET /apps/:id/inbox-account', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());

    // Mock validateAppOwnership middleware
    vi.mocked(validateAppOwnership).mockImplementation(function (req, _res, next) {
      (req as AuthenticatedRequest).agentContext = {
        customerId: 'test-customer-id',
        siteId: 'test-app-id',
        canDownload: true,
        canPublish: false,
        isE2S: false,
        product: 'AiroAppBuilder' as ProductType,
        exp: Date.now() + 3600000,
        iat: Date.now(),
      };
      next();
    });

    app.use(inboxAccountRouter);
  });

  it('should return both brandId and accountId when both exist', async () => {
    const mockBrandId = 'test-brand-id-123';
    const mockAccountId = 'test-account-id-456';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockBrandId,
        });
      }
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockAccountId,
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: mockBrandId,
      accountId: mockAccountId
    });
    expect(mockMemoryStore.get).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'test-app-id',
        customerId: 'test-customer-id',
      }),
      'integrations.inbox.brandId'
    );
    expect(mockMemoryStore.get).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'test-app-id',
        customerId: 'test-customer-id',
      }),
      'integrations.inbox.accountId'
    );
  });

  it('should return null for both when neither exists', async () => {
    mockMemoryStore.get.mockResolvedValue({
      success: true,
      exists: false,
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: null
    });
  });


  it('should return brandId when only brandId exists', async () => {
    const mockBrandId = 'test-brand-id-123';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockBrandId,
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: mockBrandId,
      accountId: null
    });
  });

  it('should return accountId when only accountId exists', async () => {
    const mockAccountId = 'test-account-id-456';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockAccountId,
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: mockAccountId
    });
  });

  it('should handle brandId read failure gracefully', async () => {
    const mockAccountId = 'test-account-id-456';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({
          success: false,
          error: 'Database error',
        });
      }
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockAccountId,
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: mockAccountId
    });
  });

  it('should handle accountId read failure gracefully', async () => {
    const mockBrandId = 'test-brand-id-123';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockBrandId,
        });
      }
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({
          success: false,
          error: 'Database error',
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: mockBrandId,
      accountId: null
    });
  });

  it('should return 500 and null values when exception occurs', async () => {
    mockMemoryStore.get.mockRejectedValue(new Error('Unexpected error'));

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(500);

    expect(response.body).toMatchObject({
      error: 'Internal server error',
      brandId: null,
      accountId: null,
    });
  });

  it('should return null when brandId has invalid data type', async () => {
    const mockAccountId = 'test-account-id-456';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: 12345, // Not a string
        });
      }
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockAccountId,
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: mockAccountId
    });
  });

  it('should return null when accountId has invalid data type', async () => {
    const mockBrandId = 'test-brand-id-123';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: mockBrandId,
        });
      }
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({
          success: true,
          exists: true,
          value: { nested: 'object' }, // Not a string
        });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: mockBrandId,
      accountId: null
    });
  });
});
