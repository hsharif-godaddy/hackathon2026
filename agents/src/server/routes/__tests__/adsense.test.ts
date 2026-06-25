import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const {
  mockReadSettings,
  mockSaveSettings,
  mockValidateAppOwnership,
} = vi.hoisted(() => ({
  mockReadSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockValidateAppOwnership: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../../../services/AdSenseSettingsFileService.js', () => ({
  AdSenseSettingsFileService: vi.fn(function () {
    return {
      readSettings: mockReadSettings,
      saveSettings: mockSaveSettings,
    };
  }),
  AdSenseSettingsValidationError: class AdSenseSettingsValidationError extends Error {
    constructor(public readonly errors: Record<string, string>) {
      super('Invalid AdSense settings');
      this.name = 'AdSenseSettingsValidationError';
    }
  },
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: mockValidateAppOwnership,
}));

import adsenseRouter from '../adsense.js';
import { AdSenseSettingsValidationError } from '../../../services/AdSenseSettingsFileService.js';
import { WorkspaceUnavailableError } from '../../../workspace/errors.js';

const appId = 'abc123def4';
const settings = {
  enabled: true,
  publisherId: 'ca-pub-1234567890123456',
  scriptSnippet: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>',
  adsTxt: { enabled: false, content: 'draft' },
  appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
  updatedAt: '2026-06-04T12:00:00.000Z',
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adsenseRouter);
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

describe('adsense routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadSettings.mockResolvedValue(settings);
    mockSaveSettings.mockResolvedValue(settings);
  });

  it('GET /apps/:id/adsense returns the direct settings body with no wrapper', async () => {
    const res = await request(createTestApp()).get(`/apps/${appId}/adsense`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(settings);
    expect(res.body.settings).toBeUndefined();
    expect(mockReadSettings).toHaveBeenCalledWith(appId);
  });

  it('PUT /apps/:id/adsense saves input and returns the direct canonical settings body with no wrapper', async () => {
    const input = {
      enabled: true,
      scriptSnippet: settings.scriptSnippet,
      adsTxt: { enabled: false, content: 'draft' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    };

    const res = await request(createTestApp())
      .put(`/apps/${appId}/adsense`)
      .send(input);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(settings);
    expect(res.body.settings).toBeUndefined();
    expect(mockSaveSettings).toHaveBeenCalledWith(appId, input);
  });

  it('returns 400 field errors for invalid input', async () => {
    mockSaveSettings.mockRejectedValue(
      new AdSenseSettingsValidationError({
        scriptSnippet: 'AdSense script must load from pagead2.googlesyndication.com.',
        adsTxt: 'ads.txt content is required when enabled.',
      }),
    );

    const res = await request(createTestApp())
      .put(`/apps/${appId}/adsense`)
      .send({ scriptSnippet: '<script src="https://example.com/ads.js"></script>' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Invalid AdSense settings',
      fields: {
        scriptSnippet: 'AdSense script must load from pagead2.googlesyndication.com.',
        adsTxt: 'ads.txt content is required when enabled.',
      },
    });
  });

  it('runs ownership middleware for GET and PUT routes', async () => {
    await request(createTestApp()).get(`/apps/${appId}/adsense`);
    await request(createTestApp()).put(`/apps/${appId}/adsense`).send({});

    expect(mockValidateAppOwnership).toHaveBeenCalledTimes(2);
    expect(mockValidateAppOwnership.mock.calls.map(([req]) => (req as Request).method)).toEqual(['GET', 'PUT']);
  });

  it('returns 404 when the preview workspace is unavailable', async () => {
    mockReadSettings.mockRejectedValue(new WorkspaceUnavailableError(appId, 'preview'));

    const res = await request(createTestApp()).get(`/apps/${appId}/adsense`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'App not found' });
  });

  it('forwards transport failures to the error handler', async () => {
    mockReadSettings.mockRejectedValue(new Error('permission denied'));

    const res = await request(createTestApp()).get(`/apps/${appId}/adsense`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'permission denied' });
  });
});
