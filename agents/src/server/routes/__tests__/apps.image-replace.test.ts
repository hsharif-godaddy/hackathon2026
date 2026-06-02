import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock dependencies before imports
vi.mock('../../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
    registerOrUpdateApp: vi.fn(),
  }; }),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req: any, _res: any, next: any) { return next(); }),
}));

vi.mock('../../../tools/ast-image-editor.js', () => ({
  astImageEditor: {
    replaceImage: vi.fn(),
  },
}));

vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    updateSlot: vi.fn(),
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
vi.mock('../../../tools/server-management-tool.js', () => ({ ServerManagementTool: vi.fn() }));
vi.mock('../../../services/name-suggestion.js', () => ({ getNameSuggestionService: vi.fn() }));
vi.mock('../../../services/features.js', () => ({ BYPASS_SITE_IDS: ['local-dev-site'] }));
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

import { astImageEditor } from '../../../tools/ast-image-editor.js';
import { mediaManifestService } from '../../../services/MediaManifestService.js';

const { appsRouter } = await import('../apps.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId: 'local-dev-site' };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
}

describe('POST /apps/:id/images/replace — slot URL detection', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  const basePayload = {
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
    imageInfo: {
      type: 'img',
      currentUrl: '/airo-assets/images/pages/home/hero',
    },
    newImageUrl: '/airo-assets/uploads/hero-abc12345.jpg',
  };

  it('updates manifest instead of AST when currentUrl is a slot URL', async () => {
    vi.mocked(mediaManifestService.updateSlot).mockResolvedValue({
      success: true,
      slot: { currentUrl: '/airo-assets/uploads/hero-abc12345.jpg' } as any,
      commitHash: 'abc1234',
    });

    const res = await request(app)
      .post('/apps/test-app/images/replace')
      .send(basePayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.slotPath).toBe('pages/home/hero');
    expect(res.body.data.commitHash).toBe('abc1234');

    // Should have called manifest update, NOT AST editor
    expect(mediaManifestService.updateSlot).toHaveBeenCalledWith(
      'test-app',
      'pages/home/hero',
      { newUrl: '/airo-assets/uploads/hero-abc12345.jpg', markUserModified: true },
    );
    expect(astImageEditor.replaceImage).not.toHaveBeenCalled();
  });

  it('falls back to AST when manifest update fails for slot URL', async () => {
    vi.mocked(mediaManifestService.updateSlot).mockResolvedValue({
      success: false,
      error: 'Slot not found',
    });
    vi.mocked(astImageEditor.replaceImage).mockResolvedValue({
      success: true,
      filePath: 'src/pages/index.tsx',
      changes: {
        oldUrl: '/airo-assets/images/pages/home/hero',
        newUrl: '/airo-assets/uploads/hero-abc12345.jpg',
        imageType: 'img',
      },
    });

    const res = await request(app)
      .post('/apps/test-app/images/replace')
      .send(basePayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    // Both should have been called — manifest first, then AST fallback
    expect(mediaManifestService.updateSlot).toHaveBeenCalled();
    expect(astImageEditor.replaceImage).toHaveBeenCalled();
  });

  it('uses AST directly when currentUrl is not a slot URL', async () => {
    vi.mocked(astImageEditor.replaceImage).mockResolvedValue({
      success: true,
      filePath: 'src/pages/index.tsx',
      changes: {
        oldUrl: '/airo-assets/uploads/old-image.jpg',
        newUrl: '/airo-assets/uploads/new-image.jpg',
        imageType: 'img',
      },
    });

    const nonSlotPayload = {
      ...basePayload,
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/old-image.jpg',
      },
      newImageUrl: '/airo-assets/uploads/new-image.jpg',
    };

    const res = await request(app)
      .post('/apps/test-app/images/replace')
      .send(nonSlotPayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    // Should go straight to AST, skip manifest
    expect(mediaManifestService.updateSlot).not.toHaveBeenCalled();
    expect(astImageEditor.replaceImage).toHaveBeenCalled();
  });

  it('uses AST directly when currentUrl is null', async () => {
    vi.mocked(astImageEditor.replaceImage).mockResolvedValue({
      success: true,
      filePath: 'src/pages/index.tsx',
      changes: {
        oldUrl: null,
        newUrl: '/airo-assets/uploads/hero-abc12345.jpg',
        imageType: 'img',
      },
    });

    const nullUrlPayload = {
      ...basePayload,
      imageInfo: { type: 'img', currentUrl: null },
    };

    const res = await request(app)
      .post('/apps/test-app/images/replace')
      .send(nullUrlPayload)
      .expect(200);

    expect(mediaManifestService.updateSlot).not.toHaveBeenCalled();
    expect(astImageEditor.replaceImage).toHaveBeenCalled();
  });
});
