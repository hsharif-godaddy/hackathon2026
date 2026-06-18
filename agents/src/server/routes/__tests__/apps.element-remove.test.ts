import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// findById return value is swapped per-test (null exercises the 404 branch).
const appRecord: { value: { id: string; path: string } | null } = {
  value: { id: 'test-app', path: '/tmp/test-app' },
};

// Mock dependencies before imports
vi.mock('../../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn(function () { return appRecord.value; }),
    registerOrUpdateApp: vi.fn(),
  }; }),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req: any, _res: any, next: any) { return next(); }),
}));

vi.mock('../../../tools/ast-element-remover.js', () => ({
  astElementRemover: {
    removeElement: vi.fn(),
  },
}));

vi.mock('../../../logging/index.js', () => {
  const instance = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    log: { forApp: vi.fn(function () { return instance; }), error: vi.fn() },
    logger: instance,
    Logger: { create: vi.fn(function () { return instance; }) },
  };
});

// Stub remaining imports that apps.ts pulls in (not under test)
vi.mock('../../../tools/directory-listing.js', () => ({ DirectoryListingTool: vi.fn() }));
vi.mock('../../../tools/read-file.js', () => ({ ReadFileTool: vi.fn() }));
vi.mock('../../../tools/file-edit.js', () => ({}));
vi.mock('../../../tools/ast-style-editor.js', () => ({ ASTStyleEditor: vi.fn() }));
vi.mock('../../../tools/ast-text-editor.js', () => ({ ASTTextEditor: vi.fn() }));
vi.mock('../../../tools/ast-image-editor.js', () => ({ astImageEditor: { replaceImage: vi.fn() } }));
vi.mock('../../../tools/server-management-tool.js', () => ({ ServerManagementTool: vi.fn() }));
vi.mock('../../../services/name-suggestion.js', () => ({ getNameSuggestionService: vi.fn() }));
vi.mock('../../../services/features.js', () => ({ BYPASS_SITE_IDS: ['local-dev-site'] }));
vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: { updateSlotOrFork: vi.fn() },
}));
vi.mock('../../../utils/slot-reference-utils.js', () => ({ parseImageSlotPath: vi.fn() }));
vi.mock('../../../utils/code-search.js', () => ({ searchCode: vi.fn() }));
vi.mock('../../middleware/jwt-auth.js', () => ({}));
vi.mock('../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn() },
}));
vi.mock('../../../services/FileUploadService.js', () => ({
  fileUploadService: { uploadFiles: vi.fn() },
}));
vi.mock('../../../utils/persistent-assets.js', () => ({
  getPersistentPublicDir: vi.fn(),
}));
vi.mock('../../../services/ImageProcessingService.js', () => ({
  imageProcessingService: { validateImageType: vi.fn(), processImage: vi.fn() },
}));

import { astElementRemover } from '../../../tools/ast-element-remover.js';

const { appsRouter } = await import('../apps.js');

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId: 'local-dev-site' };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
}

describe('POST /apps/:id/elements/remove', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    appRecord.value = { id: 'test-app', path: '/tmp/test-app' };
    app = createApp();
  });

  const basePayload = {
    selector: 'img.hero-image',
    isVideo: false,
    elementInfo: {
      tagName: 'img',
      className: 'hero-image',
      id: '',
      selector: 'img.hero-image',
      devContext: {
        fileName: 'src/pages/index.tsx',
        componentName: 'HeroSection',
        lineNumber: 10,
      },
    },
  };

  it('returns 400 when elementInfo is missing', async () => {
    const res = await request(app)
      .post('/apps/test-app/elements/remove')
      .send({ selector: 'img.hero-image', isVideo: false })
      .expect(400);

    expect(res.body).toEqual({ error: 'Element info with dev context is required' });
    expect(astElementRemover.removeElement).not.toHaveBeenCalled();
  });

  it('returns 400 when elementInfo.devContext is missing', async () => {
    const res = await request(app)
      .post('/apps/test-app/elements/remove')
      .send({
        selector: 'img.hero-image',
        isVideo: false,
        elementInfo: { tagName: 'img', className: 'hero-image', selector: 'img.hero-image' },
      })
      .expect(400);

    expect(res.body).toEqual({ error: 'Element info with dev context is required' });
    expect(astElementRemover.removeElement).not.toHaveBeenCalled();
  });

  it('returns 404 when the app is not found', async () => {
    appRecord.value = null;

    const res = await request(app)
      .post('/apps/test-app/elements/remove')
      .send(basePayload)
      .expect(404);

    expect(res.body).toEqual({ error: 'App not found' });
    expect(astElementRemover.removeElement).not.toHaveBeenCalled();
  });

  it('returns 400 when the remover reports failure', async () => {
    vi.mocked(astElementRemover.removeElement).mockResolvedValue({
      success: false,
      error: 'Could not find removable img element at line 10 in src/pages/index.tsx',
    });

    const res = await request(app)
      .post('/apps/test-app/elements/remove')
      .send(basePayload)
      .expect(400);

    expect(res.body).toEqual({
      error: 'Failed to remove element',
      details: 'Could not find removable img element at line 10 in src/pages/index.tsx',
    });
    expect(astElementRemover.removeElement).toHaveBeenCalledWith(
      '/tmp/test-app',
      expect.objectContaining({
        selector: 'img.hero-image',
        isVideo: false,
        elementInfo: expect.objectContaining({ tagName: 'img' }),
      }),
      'test-app',
    );
  });

  it('returns 500 when the remover throws', async () => {
    vi.mocked(astElementRemover.removeElement).mockRejectedValue(new Error('disk on fire'));

    const res = await request(app)
      .post('/apps/test-app/elements/remove')
      .send(basePayload)
      .expect(500);

    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('returns 200 with removal details on success', async () => {
    vi.mocked(astElementRemover.removeElement).mockResolvedValue({
      success: true,
      filePath: 'src/pages/index.tsx',
      changes: { tagName: 'img', componentName: 'HeroSection' },
      commitHash: 'abc1234',
    });

    const res = await request(app)
      .post('/apps/test-app/elements/remove')
      .send(basePayload)
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      message: 'Element removed successfully',
      data: {
        filePath: 'src/pages/index.tsx',
        changes: { tagName: 'img', componentName: 'HeroSection' },
        commitHash: 'abc1234',
      },
    });
    expect(astElementRemover.removeElement).toHaveBeenCalled();
  });
});
