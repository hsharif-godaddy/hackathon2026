import express, { Express } from 'express';
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { validateAppOwnership } from '../../middleware/app-ownership.js';
import type { AuthenticatedRequest, ProductType } from '../../middleware/jwt-auth.js';

// Mock memory store
const mockMemoryStore = {
  get: vi.fn(),
  set: vi.fn(),
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
      accountId: mockAccountId,
      embeddableId: null,
      categoryId: null
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
      accountId: null,
      embeddableId: null,
      categoryId: null
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
      accountId: null,
      embeddableId: null,
      categoryId: null
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
      accountId: mockAccountId,
      embeddableId: null,
      categoryId: null
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
      accountId: mockAccountId,
      embeddableId: null,
      categoryId: null
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
      accountId: null,
      embeddableId: null,
      categoryId: null
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
      embeddableId: null,
      categoryId: null,
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
      accountId: mockAccountId,
      embeddableId: null,
      categoryId: null
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
      accountId: null,
      embeddableId: null,
      categoryId: null
    });
  });

  it('should return embeddableId and categoryId when present', async () => {
    const mockBrandId = 'test-brand-id-123';
    const mockAccountId = 'test-account-id-456';
    const mockEmbeddableId = 789;
    const mockCategoryId = 'support';

    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({ success: true, exists: true, value: mockBrandId });
      }
      if (key === 'integrations.inbox.accountId') {
        return Promise.resolve({ success: true, exists: true, value: mockAccountId });
      }
      if (key === 'integrations.inbox.embeddableId') {
        return Promise.resolve({ success: true, exists: true, value: mockEmbeddableId });
      }
      if (key === 'integrations.inbox.contactFormCategoryId') {
        return Promise.resolve({ success: true, exists: true, value: mockCategoryId });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: mockBrandId,
      accountId: mockAccountId,
      embeddableId: mockEmbeddableId,
      categoryId: mockCategoryId
    });
  });

  it('should return a numeric categoryId when stored as a number', async () => {
    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.contactFormCategoryId') {
        return Promise.resolve({ success: true, exists: true, value: 42 });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: null,
      embeddableId: null,
      categoryId: 42
    });
  });

  it('should return null when embeddableId has invalid data type', async () => {
    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.embeddableId') {
        // Not a number (the inbox skill persists embeddableId as a number)
        return Promise.resolve({ success: true, exists: true, value: 'not-a-number' });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: null,
      embeddableId: null,
      categoryId: null
    });
  });

  it('should return null when categoryId has invalid data type', async () => {
    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.contactFormCategoryId') {
        return Promise.resolve({ success: true, exists: true, value: { nested: 'object' } });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: null,
      embeddableId: null,
      categoryId: null
    });
  });

  it('should return null for embeddableId and categoryId on a read failure', async () => {
    mockMemoryStore.get.mockImplementation((scope, key) => {
      if (key === 'integrations.inbox.embeddableId' || key === 'integrations.inbox.contactFormCategoryId') {
        return Promise.resolve({ success: false, error: 'Database error' });
      }
      return Promise.resolve({ success: true, exists: false });
    });

    const response = await request(app)
      .get('/apps/test-app-id/inbox-account')
      .expect(200);

    expect(response.body).toEqual({
      brandId: null,
      accountId: null,
      embeddableId: null,
      categoryId: null
    });
  });
});

describe('POST /apps/:id/inbox-account', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());

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

  it('persists accountId to scoped memory and returns it (no brandId)', async () => {
    const accountId = 'https://account.reamaze.example/account-123';
    mockMemoryStore.set.mockResolvedValue({ success: true });

    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId })
      .expect(200);

    expect(response.body).toEqual({ accountId, brandId: null });
    expect(mockMemoryStore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'test-app-id',
        customerId: 'test-customer-id',
      }),
      'integrations.inbox.accountId',
      accountId
    );
    // brandId not supplied → brand memory key is left untouched
    expect(mockMemoryStore.set).not.toHaveBeenCalledWith(
      expect.anything(),
      'integrations.inbox.brandId',
      expect.anything()
    );
  });

  it('persists both accountId and brandId when brandId is supplied', async () => {
    const accountId = 'https://account.reamaze.example/account-123';
    const brandId = 'https://brand.reamaze.example/brand-789';
    mockMemoryStore.set.mockResolvedValue({ success: true });

    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId, brandId })
      .expect(200);

    expect(response.body).toEqual({ accountId, brandId });
    expect(mockMemoryStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'test-app-id', customerId: 'test-customer-id' }),
      'integrations.inbox.accountId',
      accountId
    );
    expect(mockMemoryStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'test-app-id', customerId: 'test-customer-id' }),
      'integrations.inbox.brandId',
      brandId
    );
  });

  it('ignores a blank brandId and persists accountId only', async () => {
    const accountId = 'https://account.reamaze.example/account-123';
    mockMemoryStore.set.mockResolvedValue({ success: true });

    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId, brandId: '   ' })
      .expect(200);

    expect(response.body).toEqual({ accountId, brandId: null });
    expect(mockMemoryStore.set).not.toHaveBeenCalledWith(
      expect.anything(),
      'integrations.inbox.brandId',
      expect.anything()
    );
  });

  it('returns 500 when the brandId write fails', async () => {
    const accountId = 'https://account.reamaze.example/account-123';
    mockMemoryStore.set.mockImplementation((_scope, key) => {
      if (key === 'integrations.inbox.brandId') {
        return Promise.resolve({ success: false, error: 'db error' });
      }
      return Promise.resolve({ success: true });
    });

    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId, brandId: 'https://brand.reamaze.example/brand-789' })
      .expect(500);

    expect(response.body).toMatchObject({ error: expect.any(String) });
    // brandId is written before accountId, so a brandId failure must abort before the accountId
    // write — leaving the app in its prior (pre-heal) state rather than accountId-without-brandId.
    expect(mockMemoryStore.set).not.toHaveBeenCalledWith(
      expect.anything(),
      'integrations.inbox.accountId',
      expect.anything()
    );
  });

  it('returns 400 when accountId is missing', async () => {
    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({})
      .expect(400);

    expect(response.body).toMatchObject({ error: expect.any(String) });
    expect(mockMemoryStore.set).not.toHaveBeenCalled();
  });

  it('returns 400 when accountId is not a non-empty string', async () => {
    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId: '   ' })
      .expect(400);

    expect(response.body).toMatchObject({ error: expect.any(String) });
    expect(mockMemoryStore.set).not.toHaveBeenCalled();
  });

  it('returns 500 when the memory write fails', async () => {
    mockMemoryStore.set.mockResolvedValue({ success: false, error: 'db error' });

    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId: 'https://account.reamaze.example/account-123' })
      .expect(500);

    expect(response.body).toMatchObject({ error: expect.any(String) });
  });

  it('returns 500 when the memory write throws', async () => {
    mockMemoryStore.set.mockRejectedValue(new Error('Unexpected error'));

    const response = await request(app)
      .post('/apps/test-app-id/inbox-account')
      .send({ accountId: 'https://account.reamaze.example/account-123' })
      .expect(500);

    expect(response.body).toMatchObject({ error: 'Internal server error' });
  });
});
