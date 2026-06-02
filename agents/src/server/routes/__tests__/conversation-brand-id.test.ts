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
const { default: conversationBrandIdRouter } = await import('../conversation-brand-id.js');

describe('GET /apps/:id/conversation-brand-id', () => {
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

    app.use(conversationBrandIdRouter);
  });

  it('should return brand ID from memory', async () => {
    const mockBrandId = 'test-brand-id-123';

    mockMemoryStore.get.mockResolvedValue({
      success: true,
      exists: true,
      value: mockBrandId,
    });

    const response = await request(app)
      .get('/apps/test-app-id/conversation-brand-id')
      .expect(200);

    expect(response.body).toEqual({ brandId: mockBrandId });
    expect(mockMemoryStore.get).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'test-app-id',
        customerId: 'test-customer-id',
      }),
      'integrations.inbox.brandId'
    );
  });

  it('should return null when brand ID does not exist', async () => {
    mockMemoryStore.get.mockResolvedValue({
      success: true,
      exists: false,
    });

    const response = await request(app)
      .get('/apps/test-app-id/conversation-brand-id')
      .expect(200);

    expect(response.body).toEqual({ brandId: null });
  });

  it('should return 500 when memory read fails', async () => {
    mockMemoryStore.get.mockResolvedValue({
      success: false,
      error: 'Database error',
    });

    const response = await request(app)
      .get('/apps/test-app-id/conversation-brand-id')
      .expect(500);

    expect(response.body).toMatchObject({
      error: 'Failed to read brand ID from memory',
      brandId: null,
    });
  });

  it('should return null when data structure is invalid', async () => {
    mockMemoryStore.get.mockResolvedValue({
      success: true,
      exists: true,
      value: 12345, // Not a string
    });

    const response = await request(app)
      .get('/apps/test-app-id/conversation-brand-id')
      .expect(200);

    expect(response.body).toEqual({ brandId: null });
  });
});
