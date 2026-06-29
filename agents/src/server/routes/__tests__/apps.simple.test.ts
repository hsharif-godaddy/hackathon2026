import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockSuggestName = vi.hoisted(() => vi.fn());

vi.mock('../../../services/name-suggestion.js', () => ({
  getNameSuggestionService: () => ({ suggestName: mockSuggestName }),
}));

import { appsRouter } from '../apps.js';
import { AppRepository } from '../../../database/index.js';
import type { App } from '../../../database/index.js';

// Build an Express app whose auth context reports the given siteId.
const createTestAppForSite = (siteId: string): express.Express => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
};

// Create test Express app with fake auth context using a bypass siteId
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  // Inject agentContext so auth checks pass
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId: 'local-dev-site' };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
};

describe('Apps Routes Basic Tests', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = createTestApp();
  });

  beforeEach(() => {
    mockSuggestName.mockReset();
    mockSuggestName.mockResolvedValue('Suggested App');
  });

  it('should return 404 for non-existent app styles edit', async () => {
    const response = await request(app)
      .post('/apps/non-existent-id/styles/edit')
      .send({
        selector: 'p',
        property: 'color',
        value: 'red',
        elementInfo: { devContext: { fileName: 'test.tsx', componentName: 'Test', lineNumber: 1 } }
      })
      .expect(404);

    expect(response.body.error).toBe('App not found');
  });

  it('should return 400 for missing selector', async () => {
    const response = await request(app)
      .post('/apps/some-id/styles/edit')
      .send({
        property: 'color',
        value: 'red',
        elementInfo: { devContext: { fileName: 'test.tsx', componentName: 'Test', lineNumber: 1 } }
      })
      .expect(400);

    expect(response.body.error).toBe('Selector, property, and value are required');
  });

  it('should return 400 for missing element info', async () => {
    const response = await request(app)
      .post('/apps/some-id/styles/edit')
      .send({
        selector: 'p',
        property: 'color',
        value: 'red'
      })
      .expect(400);

    expect(response.body.error).toBe('Element info with dev context is required');
  });

  it('should handle basic app routes', async () => {
    // Test the basic apps list endpoint
    const response = await request(app)
      .get('/apps')
      .expect(200);

    expect(response.body).toHaveProperty('apps');
    expect(Array.isArray(response.body.apps)).toBe(true);
  });

  it('should test route structure', async () => {
    const response = await request(app)
      .post('/apps/test-id/styles/edit')
      .send({});

    // Should be 400 (bad request) or 404 (not found), but not 404 due to missing route
    expect([400, 404]).toContain(response.status);
  });

  it('strips hyphenated /agent commands before suggesting a name', async () => {
    const response = await request(app)
      .post('/apps/suggest-name')
      .send({ prompt: '/agent initial-v3\nBuild a pricing page' })
      .expect(200);

    expect(mockSuggestName).toHaveBeenCalledWith('Build a pricing page');
    expect(response.body.prompt).toBe('Build a pricing page');
  });

  it('passes bodyless /agent commands through when suggesting a name', async () => {
    const response = await request(app)
      .post('/apps/suggest-name')
      .send({ prompt: '/agent initial-v3' })
      .expect(200);

    expect(mockSuggestName).toHaveBeenCalledWith('/agent initial-v3');
    expect(response.body.prompt).toBe('/agent initial-v3');
  });
});

describe('GET /apps siteId scoping', () => {
  const siteId = 'realsiteid1';

  const buildOwnedApp = (): App => ({
    id: siteId,
    name: 'Owned App',
    path: `/apps/${siteId}`,
    port: 4001,
    status: 'created',
    publishedUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps a non-bypass site’s owned app in an array', async () => {
    const findByIdSpy = vi
      .spyOn(AppRepository.prototype, 'findById')
      .mockReturnValue(buildOwnedApp());
    vi.spyOn(AppRepository.prototype, 'countBySiteId').mockReturnValue(1);

    const response = await request(createTestAppForSite(siteId))
      .get('/apps')
      .expect(200);

    expect(Array.isArray(response.body.apps)).toBe(true);
    expect(response.body.apps).toHaveLength(1);
    expect(response.body.apps[0].id).toBe(siteId);
    expect(findByIdSpy).toHaveBeenCalledWith(siteId);
  });

  it('returns an empty array (not null) when a non-bypass site owns no app', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(null);
    vi.spyOn(AppRepository.prototype, 'countBySiteId').mockReturnValue(0);

    const response = await request(createTestAppForSite('orphansite1'))
      .get('/apps')
      .expect(200);

    expect(Array.isArray(response.body.apps)).toBe(true);
    expect(response.body.apps).toHaveLength(0);
  });
});
