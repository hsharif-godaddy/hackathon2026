import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdate = vi.hoisted(() => vi.fn());
const MockValidationError = vi.hoisted(() => class FormatOverrideValidationError extends Error {});
const MockNotFoundError = vi.hoisted(() => class FormatOverrideNotFoundError extends Error {});

vi.mock('../../../services/FormatOverrideService.js', () => ({
  FormatOverrideValidationError: MockValidationError,
  FormatOverrideNotFoundError: MockNotFoundError,
  FormatOverrideService: vi.fn().mockImplementation(function service() {
    return { update: mockUpdate };
  }),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((_req, _res, next) => next()),
}));

import formatOverridesRouter from '../format-overrides.js';
import { WorkspaceUnavailableError } from '../../../workspace/errors.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/apps', formatOverridesRouter);
  return app;
}

describe('format override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ success: true, commitHash: 'abc1234' });
  });

  it('updates format overrides for an app', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/apps/app1234567/format-overrides')
      .send({
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          expressionHash: `sha256:${'a'.repeat(64)}`,
        },
        marks: { bold: true },
      })
      .expect(200);

    expect(response.body).toEqual({ success: true, commitHash: 'abc1234' });
    expect(mockUpdate).toHaveBeenCalledWith('app1234567', {
      devId: 'abc123',
      target: {
        file: 'src/pages/index.tsx',
        tagName: 'h1',
        sourceKind: 'bound-expression',
        expressionHash: `sha256:${'a'.repeat(64)}`,
      },
      marks: { bold: true },
    });
  });

  it('returns 400 for validation errors', async () => {
    mockUpdate.mockRejectedValueOnce(new MockValidationError('devId is required'));

    const response = await request(createTestApp())
      .post('/apps/app1234567/format-overrides')
      .send({ target: {}, marks: {} })
      .expect(400);

    expect(response.body).toEqual({ success: false, error: 'devId is required' });
  });

  it('returns 404 when the app is missing', async () => {
    mockUpdate.mockRejectedValueOnce(new MockNotFoundError('App not found'));

    const response = await request(createTestApp())
      .post('/apps/app1234567/format-overrides')
      .send({ devId: 'abc123', target: {}, marks: {} })
      .expect(404);

    expect(response.body).toEqual({ success: false, error: 'App not found' });
  });

  it('returns 503 when the workspace is unavailable', async () => {
    mockUpdate.mockRejectedValueOnce(new WorkspaceUnavailableError('app1234567', 'preview'));

    const response = await request(createTestApp())
      .post('/apps/app1234567/format-overrides')
      .send({ devId: 'abc123', target: {}, marks: {} })
      .expect(503);

    expect(response.body).toEqual({ success: false, error: 'Workspace unavailable' });
  });

  it('returns a generic 500 for unexpected service failures', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('EACCES: permission denied, open /tmp/private/path'));

    const response = await request(createTestApp())
      .post('/apps/app1234567/format-overrides')
      .send({
        devId: 'abc123',
        target: {
          file: 'src/pages/index.tsx',
          tagName: 'h1',
          sourceKind: 'bound-expression',
          expressionHash: `sha256:${'a'.repeat(64)}`,
        },
        marks: { bold: true },
      })
      .expect(500);

    expect(response.body).toEqual({ success: false, error: 'Internal server error' });
  });
});
