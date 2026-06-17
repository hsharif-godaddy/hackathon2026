import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req: unknown, _res: unknown, next: () => void) { return next(); }),
}));

vi.mock('../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: function child() { return instance; },
  };
  return {
    logger: instance,
    Logger: { create: () => instance },
  };
});

vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    getSlot: vi.fn(),
    updateSlotOrFork: vi.fn(),
  },
}));

import { mediaManifestService } from '../../../services/MediaManifestService.js';

const { default: mediaRouter } = await import('../media.js');

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/media', mediaRouter);
  return app;
}

describe('PUT /media/:appId/slots/:slotName', function packageTests() {
  let app: express.Express;

  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: { currentUrl: '/airo-assets/uploads/old.jpg' } as any,
    });
    app = createApp();
  });

  it('updates slot in place when fork is not needed', async function updateInPlace() {
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
      success: true,
      forked: false,
      slot: { currentUrl: '/airo-assets/uploads/new.jpg' } as any,
      commitHash: 'abc1234',
    });

    const res = await request(app)
      .put('/media/test-app/slots/pages/home/hero')
      .send({ newUrl: '/airo-assets/uploads/new.jpg' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.forked).toBe(false);
    expect(res.body.slotPath).toBe('pages/home/hero');
    expect(mediaManifestService.updateSlotOrFork).toHaveBeenCalledWith(
      'test-app',
      'pages/home/hero',
      expect.objectContaining({
        newUrl: '/airo-assets/uploads/new.jpg',
        forkContext: null,
      }),
    );
  });

  it('forks shared slot when preview element context is provided', async function forkShared() {
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
      success: true,
      forked: true,
      slotPath: 'pages/home/hero-2',
      originalSlotPath: 'pages/home/hero',
      slot: { currentUrl: '/airo-assets/uploads/new.jpg' } as any,
      commitHash: 'fork1234',
    });

    const res = await request(app)
      .put('/media/test-app/slots/pages/home/hero')
      .send({
        newUrl: '/airo-assets/uploads/new.jpg',
        forkContext: {
          selector: 'html > body > ul > li:nth-child(2) > img:nth-child(1)',
          devContext: {
            fileName: 'src/pages/home.tsx',
            componentName: 'HomePage',
            lineNumber: 42,
          },
          elementInfo: {
            tagName: 'img',
            className: '',
            id: '',
            selector: 'html > body > ul > li:nth-child(2) > img:nth-child(1)',
            devContext: {
              fileName: 'src/pages/home.tsx',
              componentName: 'HomePage',
              lineNumber: 42,
            },
          },
          imageInfo: {
            type: 'img',
            currentUrl: 'https://preview.example.com/airo-assets/images/pages/home/hero',
          },
        },
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.forked).toBe(true);
    expect(res.body.slotPath).toBe('pages/home/hero-2');
    expect(res.body.originalSlotPath).toBe('pages/home/hero');
    expect(mediaManifestService.updateSlotOrFork).toHaveBeenCalledWith(
      'test-app',
      'pages/home/hero',
      expect.objectContaining({
        forkContext: expect.objectContaining({
          selector: 'html > body > ul > li:nth-child(2) > img:nth-child(1)',
        }),
      }),
    );
  });

  it('passes occurrenceIndex when forking without full element context', async function forkByOccurrenceIndex() {
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
      success: true,
      forked: true,
      slotPath: 'pages/home/hero-2',
      originalSlotPath: 'pages/home/hero',
      slot: { currentUrl: '/airo-assets/uploads/new.jpg' } as any,
      commitHash: 'fork5678',
    });

    const res = await request(app)
      .put('/media/test-app/slots/pages/home/hero')
      .send({
        newUrl: '/airo-assets/uploads/new.jpg',
        occurrenceIndex: 2,
      })
      .expect(200);

    expect(res.body.forked).toBe(true);
    expect(mediaManifestService.updateSlotOrFork).toHaveBeenCalledWith(
      'test-app',
      'pages/home/hero',
      expect.objectContaining({
        occurrenceIndex: 2,
        forkContext: null,
      }),
    );
  });
});
