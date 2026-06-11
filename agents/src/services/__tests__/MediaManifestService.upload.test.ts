import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import type { MediaSlot } from '../MediaManifestService.js';

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  },
}));

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

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {} }),
}));

vi.mock('../../tools/ast-image-editor.js', () => ({
  astImageEditor: { replaceImage: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('../GettyUploadService.js', () => ({
  gettyUploadService: { uploadAndReport: vi.fn().mockResolvedValue([]), reportUsage: vi.fn() },
}));

import { MediaManifestService, classifyOrientation, type MediaManifest } from '../MediaManifestService.js';

const AI_TRANSPARENT = 'https://logos.example.com/old-transparent.png';
const AI_SOLID = 'https://logos.example.com/old-solid.png';
const UPLOAD_URL = '/airo-assets/uploads/logo-horizontal-abcd1234.png';

function makeAiHorizontalLogo(): MediaSlot {
  return {
    mediaType: 'logo',
    currentUrl: AI_TRANSPARENT,
    searchQuery: 'Acme',
    alternatives: [],
    solidUrlMap: { [AI_TRANSPARENT]: AI_SOLID },
    reversedUrlMap: { [AI_TRANSPARENT]: 'https://logos.example.com/old-reversed.png' },
    reversedSolidUrlMap: { [AI_TRANSPARENT]: 'https://logos.example.com/old-reversed-solid.png' },
    mockupUrlMap: { [AI_TRANSPARENT]: 'https://logos.example.com/old-mockup.png' },
    landscapeMockupUrlMap: { [AI_TRANSPARENT]: 'https://logos.example.com/old-landscape.png' },
    logoSourceMap: { [AI_TRANSPARENT]: { sessionId: 'sess-1', logoId: 'logo-1' } },
    userModified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

function readWrittenManifest(): MediaManifest {
  const writeCall = vi.mocked(fs.writeFile).mock.calls.find(([p]) => String(p).endsWith('.tmp'));
  if (!writeCall) throw new Error('writeFile was not called for the manifest');
  return JSON.parse(String(writeCall[1])) as MediaManifest;
}

describe('classifyOrientation', () => {
  it('classifies wide images as horizontal', () => {
    expect(classifyOrientation({ width: 1536, height: 1024 })).toBe('horizontal');
    expect(classifyOrientation({ width: 100, height: 80 })).toBe('horizontal');
  });

  it('classifies tall images as vertical', () => {
    expect(classifyOrientation({ width: 1024, height: 1536 })).toBe('vertical');
    expect(classifyOrientation({ width: 80, height: 100 })).toBe('vertical');
  });

  it('classifies near-square images as square', () => {
    expect(classifyOrientation({ width: 512, height: 512 })).toBe('square');
    expect(classifyOrientation({ width: 100, height: 95 })).toBe('square');
    expect(classifyOrientation({ width: 95, height: 100 })).toBe('square');
  });

  it('returns undefined for invalid dimensions', () => {
    expect(classifyOrientation({ width: 0, height: 100 })).toBeUndefined();
    expect(classifyOrientation({ width: 100, height: 0 })).toBeUndefined();
    expect(classifyOrientation({ width: -1, height: 100 })).toBeUndefined();
  });
});

describe('updateSlotWithUpload — logo variant-map clearing & sibling propagation', () => {
  let service: MediaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MediaManifestService();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
  });

  it('clears stale variant maps and sets naturalOrientation when a square upload lands in logo/horizontal', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo() }));

    const result = await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      sourceFilename: 'my-logo.png',
      dimensions: { width: 225, height: 225 },
    });

    expect(result.success).toBe(true);
    const written = readWrittenManifest();
    const horizontal = written['logo/horizontal'];
    expect(horizontal.currentUrl).toBe(UPLOAD_URL);
    expect(horizontal.naturalOrientation).toBe('square');
    expect(horizontal.userModified).toBe(true);
    expect(horizontal.solidUrlMap).toBeUndefined();
    expect(horizontal.reversedUrlMap).toBeUndefined();
    expect(horizontal.reversedSolidUrlMap).toBeUndefined();
    expect(horizontal.mockupUrlMap).toBeUndefined();
    expect(horizontal.landscapeMockupUrlMap).toBeUndefined();
    expect(horizontal.logoSourceMap).toBeUndefined();
  });

  it('co-populates logo/primary when the square upload natural orientation differs from the targeted logo/horizontal slot', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo() }));

    await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      sourceFilename: 'my-logo.png',
      dimensions: { width: 225, height: 225 },
    });

    const written = readWrittenManifest();
    const primary = written['logo/primary'];
    expect(primary).toBeDefined();
    expect(primary.mediaType).toBe('logo');
    expect(primary.currentUrl).toBe(UPLOAD_URL);
    expect(primary.naturalOrientation).toBe('square');
    expect(primary.userModified).toBe(true);
    expect(primary.solidUrlMap).toBeUndefined();
    expect(primary.uploadSources).toEqual({ [UPLOAD_URL]: 'my-logo.png' });
  });

  it('does not write a sibling when the upload orientation matches the targeted slot', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo() }));

    await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      dimensions: { width: 1536, height: 1024 },
    });

    const written = readWrittenManifest();
    expect(written['logo/horizontal'].naturalOrientation).toBe('horizontal');
    expect(written['logo/primary']).toBeUndefined();
    expect(written['logo/vertical']).toBeUndefined();
  });

  it('preserves an existing sibling slot\'s prior currentUrl in alternatives when the sibling already exists', async () => {
    const priorSibling: MediaSlot = {
      mediaType: 'logo',
      currentUrl: 'https://logos.example.com/old-square.png',
      searchQuery: '',
      alternatives: [],
      userModified: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
      solidUrlMap: { 'https://logos.example.com/old-square.png': 'https://logos.example.com/old-square-solid.png' },
    };
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo(), 'logo/primary': priorSibling }),
    );

    await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      dimensions: { width: 225, height: 225 },
    });

    const written = readWrittenManifest();
    const primary = written['logo/primary'];
    expect(primary.currentUrl).toBe(UPLOAD_URL);
    expect(primary.alternatives).toContain('https://logos.example.com/old-square.png');
    expect(primary.solidUrlMap).toBeUndefined();
  });

  it('does not overwrite a sibling slot that already holds a deliberate user upload', async () => {
    const userOwnedSquareUrl = '/airo-assets/uploads/user-square-earlier.png';
    const deliberateSibling: MediaSlot = {
      mediaType: 'logo',
      currentUrl: userOwnedSquareUrl,
      searchQuery: '',
      alternatives: [],
      userModified: true,
      naturalOrientation: 'square',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-02T00:00:00.000Z',
      uploadSources: { [userOwnedSquareUrl]: 'earlier-square.png' },
    };
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo(), 'logo/primary': deliberateSibling }),
    );

    await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      sourceFilename: 'new-square.png',
      dimensions: { width: 225, height: 225 },
    });

    const written = readWrittenManifest();
    expect(written['logo/horizontal'].currentUrl).toBe(UPLOAD_URL);
    // Sibling preserved verbatim — user's earlier deliberate choice not demoted.
    expect(written['logo/primary']).toEqual(deliberateSibling);
  });

  it('still propagates to a sibling whose currentUrl already equals the upload (re-upload of same URL)', async () => {
    const sameUrlSibling: MediaSlot = {
      mediaType: 'logo',
      currentUrl: UPLOAD_URL,
      searchQuery: '',
      alternatives: [],
      userModified: true,
      naturalOrientation: 'square',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo(), 'logo/primary': sameUrlSibling }),
    );

    await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      sourceFilename: 'same.png',
      dimensions: { width: 225, height: 225 },
    });

    const written = readWrittenManifest();
    expect(written['logo/primary'].currentUrl).toBe(UPLOAD_URL);
    expect(written['logo/primary'].lastUpdated).not.toBe('2026-01-01T00:00:00.000Z');
    expect(written['logo/primary'].uploadSources).toEqual({ [UPLOAD_URL]: 'same.png' });
  });

  it('clears variant maps even when no dimensions are provided (the maps are stale regardless)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'logo/horizontal': makeAiHorizontalLogo() }));

    await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL);

    const written = readWrittenManifest();
    expect(written['logo/horizontal'].solidUrlMap).toBeUndefined();
    expect(written['logo/horizontal'].naturalOrientation).toBeUndefined();
    expect(written['logo/primary']).toBeUndefined();
  });

  it('clears naturalOrientation on updateSlot when currentUrl changes (e.g. user reverts to AI alternative)', async () => {
    const aiUrl = 'https://logos.example.com/ai-horizontal-transparent.png';
    const slotWithUploadAndOrientation: MediaSlot = {
      mediaType: 'logo',
      currentUrl: UPLOAD_URL,
      naturalOrientation: 'square',
      searchQuery: '',
      alternatives: [aiUrl],
      userModified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-02T00:00:00.000Z',
    };
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ 'logo/horizontal': slotWithUploadAndOrientation }),
    );

    const result = await service.updateSlot('test-app', 'logo/horizontal', { newUrl: aiUrl });

    expect(result.success).toBe(true);
    const written = readWrittenManifest();
    expect(written['logo/horizontal'].currentUrl).toBe(aiUrl);
    expect(written['logo/horizontal'].naturalOrientation).toBeUndefined();
  });

  it('clears pendingJobId on updateSlotWithUpload (user-driven upload drops the in-progress marker)', async () => {
    const slotMidJob: MediaSlot = {
      ...makeAiHorizontalLogo(),
      pendingJobId: 'job-abc-123',
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'logo/horizontal': slotMidJob }));

    const result = await service.updateSlotWithUpload('test-app', 'logo/horizontal', UPLOAD_URL, {
      dimensions: { width: 1536, height: 1024 },
    });

    expect(result.success).toBe(true);
    const written = readWrittenManifest();
    expect(written['logo/horizontal'].currentUrl).toBe(UPLOAD_URL);
    expect(written['logo/horizontal'].pendingJobId).toBeUndefined();
  });

  it('clears pendingJobId on updateSlot (user-driven currentUrl change drops the in-progress marker)', async () => {
    const aiUrl = 'https://logos.example.com/ai-horizontal-transparent.png';
    const slotMidJob: MediaSlot = {
      mediaType: 'logo',
      currentUrl: UPLOAD_URL,
      pendingJobId: 'job-abc-123',
      searchQuery: '',
      alternatives: [aiUrl],
      userModified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-02T00:00:00.000Z',
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'logo/horizontal': slotMidJob }));

    const result = await service.updateSlot('test-app', 'logo/horizontal', { newUrl: aiUrl });

    expect(result.success).toBe(true);
    const written = readWrittenManifest();
    expect(written['logo/horizontal'].currentUrl).toBe(aiUrl);
    expect(written['logo/horizontal'].pendingJobId).toBeUndefined();
  });

  it('leaves non-logo slots untouched: no variant-map clearing, no naturalOrientation, no sibling writes', async () => {
    const heroSlot: MediaSlot = {
      mediaType: 'image',
      currentUrl: 'https://media.example.com/hero-old.jpg',
      searchQuery: 'cafe',
      alternatives: [],
      userModified: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'pages/home/hero': heroSlot }));

    await service.updateSlotWithUpload('test-app', 'pages/home/hero', '/airo-assets/uploads/hero-xyz.jpg', {
      dimensions: { width: 1920, height: 1080 },
    });

    const written = readWrittenManifest();
    expect(written['pages/home/hero'].currentUrl).toBe('/airo-assets/uploads/hero-xyz.jpg');
    expect(written['pages/home/hero'].naturalOrientation).toBeUndefined();
    expect(Object.keys(written)).toEqual(['pages/home/hero']);
  });
});
