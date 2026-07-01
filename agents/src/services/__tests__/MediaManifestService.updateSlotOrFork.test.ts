import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import type { MediaManifest, MediaSlot } from '../MediaManifestService.js';

vi.mock('node:fs/promises', () => {
  const mod = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
  return { default: mod, ...mod };
});

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
  }; }),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn(),
}));

vi.mock('../../logging/index.js', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: stub,
    Logger: { create: vi.fn(() => stub) },
  };
});

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {} }),
}));

vi.mock('../../tools/ast-image-editor.js', () => ({
  astImageEditor: {
    replaceImage: vi.fn().mockResolvedValue({ success: true }),
    replaceSharedSlotReference: vi.fn().mockResolvedValue({ success: true, filePath: 'src/pages/index.tsx' }),
  },
}));

vi.mock('../GettyUploadService.js', () => ({
  gettyUploadService: { uploadAndReport: vi.fn().mockResolvedValue([]), reportUsage: vi.fn() },
}));

const { countSlotUrlReferences: mockCountSlotUrlReferences } = vi.hoisted(() => ({
  countSlotUrlReferences: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../utils/slot-reference-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/slot-reference-utils.js')>();
  return {
    ...actual,
    countSlotUrlReferences: mockCountSlotUrlReferences,
  };
});

import { AppRepository } from '../../database/repositories/AppRepository.js';
import { GitUtils } from '../../utils/git.js';
import { MediaManifestService } from '../MediaManifestService.js';
import { imageSlotUrl } from '../../utils/slot-reference-utils.js';

const SLOT_NAME = 'pages/home/hero';

function makeSlot(overrides: Partial<MediaSlot> = {}): MediaSlot {
  return {
    mediaType: 'image',
    currentUrl: '/airo-assets/uploads/hero-abc123.jpg',
    searchQuery: 'hero',
    alternatives: ['/airo-assets/uploads/hero-alt1.jpg'],
    userModified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stubManifest(manifest: MediaManifest): void {
  vi.mocked(fs.readFile).mockImplementation(async (filePath: unknown) => {
    if (String(filePath).endsWith('airo-media.json')) {
      return JSON.stringify(manifest);
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

describe('MediaManifestService.updateSlotOrFork', function packageTests() {
  let service: MediaManifestService;

  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.mocked(AppRepository).mockImplementation(function () { return {
      findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
    }; });
    service = new MediaManifestService();

    vi.mocked(GitUtils).mockImplementation(function (this: Record<string, unknown>) {
      this.addFiles = vi.fn().mockResolvedValue({ success: true });
      this.getStatus = vi.fn().mockResolvedValue({ stagedFiles: 1 });
      this.commit = vi.fn().mockResolvedValue({ success: true });
      this.getLastCommit = vi.fn().mockResolvedValue({ hash: 'abc1234' });
    } as unknown as () => void);

    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
  });

  it('does not fork when refCount is 1 and sourceRef file matches despite drifted line number', async function driftedLineSameFile() {
    // Manifest's sourceRef says line 45; the click reports line 91 (drifted after AI edits).
    // Since isSharedSlotReference compares only the file name (ignoring line numbers),
    // this should route to updateSlot (not fork).
    const manifest: MediaManifest = {
      [SLOT_NAME]: makeSlot({
        sourceRef: 'src/pages/index.tsx:45',
      }),
    };
    stubManifest(manifest);
    mockCountSlotUrlReferences.mockResolvedValue(1);

    const result = await service.updateSlotOrFork('test-app', SLOT_NAME, {
      newUrl: '/airo-assets/uploads/hero-alt1.jpg',
      forkContext: {
        devContext: { fileName: 'src/pages/index.tsx', componentName: 'Home', lineNumber: 91 },
        elementInfo: {
          tagName: 'img',
          className: '',
          id: '',
          selector: 'img',
          devContext: { fileName: 'src/pages/index.tsx', componentName: 'Home', lineNumber: 91 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_NAME) },
        selector: '',
      },
      occurrenceIndex: 0,
    });

    expect(result.success).toBe(true);
    expect(result.forked).toBe(false);
  });

  it('forks when refCount is 1 but sourceRef file differs from click file', async function differentFile() {
    const manifest: MediaManifest = {
      [SLOT_NAME]: makeSlot({
        sourceRef: 'src/data/images.ts:4',
      }),
    };
    stubManifest(manifest);
    mockCountSlotUrlReferences.mockResolvedValue(1);

    const result = await service.updateSlotOrFork('test-app', SLOT_NAME, {
      newUrl: '/airo-assets/uploads/hero-alt1.jpg',
      forkContext: {
        devContext: { fileName: 'src/pages/index.tsx', componentName: 'Home', lineNumber: 12 },
        elementInfo: {
          tagName: 'img',
          className: '',
          id: '',
          selector: 'img',
          devContext: { fileName: 'src/pages/index.tsx', componentName: 'Home', lineNumber: 12 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_NAME) },
        selector: '',
      },
      occurrenceIndex: 0,
    });

    expect(result.attemptedFork).toBe(true);
    expect(result.success).toBe(true);
    expect(result.forked).toBe(true);
  });

  it('returns error when slot is shared but no fork context can repoint', async function sharedNoRepoint() {
    const manifest: MediaManifest = {
      [SLOT_NAME]: makeSlot({
        sourceRef: 'src/data/images.ts:4',
      }),
    };
    stubManifest(manifest);
    mockCountSlotUrlReferences.mockResolvedValue(2);

    const result = await service.updateSlotOrFork('test-app', SLOT_NAME, {
      newUrl: '/airo-assets/uploads/hero-alt1.jpg',
      forkContext: {
        devContext: { fileName: 'unknown', componentName: 'unknown', lineNumber: 0 },
        elementInfo: {
          tagName: 'img',
          className: '',
          id: '',
          selector: '',
          devContext: { fileName: 'unknown', componentName: 'unknown', lineNumber: 0 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_NAME) },
        selector: '',
      },
      occurrenceIndex: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not identify which item to update');
    expect(result.forked).toBeUndefined();
  });
});
