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
    updateSlotOrFork: vi.fn(),
  },
}));

vi.mock('../../../utils/slot-reference-utils.js', () => ({
  parseImageSlotPath: vi.fn(),
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
import { parseImageSlotPath } from '../../../utils/slot-reference-utils.js';

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
    vi.mocked(parseImageSlotPath).mockReturnValue('pages/home/hero');
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
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
      success: true,
      forked: false,
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

    expect(mediaManifestService.updateSlotOrFork).toHaveBeenCalledWith(
      'test-app',
      'pages/home/hero',
      expect.objectContaining({
        newUrl: '/airo-assets/uploads/hero-abc12345.jpg',
        updateOptions: { markUserModified: true },
        forkContext: expect.objectContaining({
          selector: 'img.hero-image',
        }),
      }),
    );
    expect(astImageEditor.replaceImage).not.toHaveBeenCalled();
  });

  it('forks manifest when slot URL is referenced from multiple source records', async () => {
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
      success: true,
      forked: true,
      slotPath: 'pages/home/hero-2',
      originalSlotPath: 'pages/home/hero',
      commitHash: 'fork1234',
    });

    const res = await request(app)
      .post('/apps/test-app/images/replace')
      .send({
        ...basePayload,
        elementInfo: {
          ...basePayload.elementInfo,
          selector: 'html:nth-child(1) > body:nth-child(1) > div:nth-child(1) > ul:nth-child(1) > li:nth-child(3) > img:nth-child(1)',
        },
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.slotPath).toBe('pages/home/hero-2');
    expect(res.body.data.originalSlotPath).toBe('pages/home/hero');
    expect(astImageEditor.replaceImage).not.toHaveBeenCalled();
  });

  it('parses absolute slot URLs from browser img.src', async () => {
    vi.mocked(parseImageSlotPath).mockReturnValue('pages/home/hero');
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
      success: true,
      forked: false,
      commitHash: 'abc1234',
    });

    await request(app)
      .post('/apps/test-app/images/replace')
      .send({
        ...basePayload,
        imageInfo: {
          type: 'img',
          currentUrl: 'https://preview.example.com/airo-assets/images/pages/home/hero?v=1',
        },
      })
      .expect(200);

    expect(parseImageSlotPath).toHaveBeenCalledWith(
      'https://preview.example.com/airo-assets/images/pages/home/hero?v=1',
    );
    expect(mediaManifestService.updateSlotOrFork).toHaveBeenCalled();
  });

  it('falls back to AST when manifest update fails for slot URL', async () => {
    vi.mocked(mediaManifestService.updateSlotOrFork).mockResolvedValue({
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
    expect(mediaManifestService.updateSlotOrFork).toHaveBeenCalled();
    expect(astImageEditor.replaceImage).toHaveBeenCalled();
  });

  it('uses AST directly when currentUrl is not a slot URL', async () => {
    vi.mocked(parseImageSlotPath).mockReturnValue(null);
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
    expect(mediaManifestService.updateSlotOrFork).not.toHaveBeenCalled();
    expect(astImageEditor.replaceImage).toHaveBeenCalled();
  });

  it('uses AST directly when currentUrl is null', async () => {
    vi.mocked(parseImageSlotPath).mockReturnValue(null);
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

    await request(app)
      .post('/apps/test-app/images/replace')
      .send(nullUrlPayload)
      .expect(200);

    expect(mediaManifestService.updateSlotOrFork).not.toHaveBeenCalled();
    expect(astImageEditor.replaceImage).toHaveBeenCalled();
  });
});
