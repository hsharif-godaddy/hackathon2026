import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaSlot } from '../../services/MediaManifestService.js';

const { importChatUploadToSlotMock } = vi.hoisted(() => ({
  importChatUploadToSlotMock: vi.fn(),
}));

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@airo/ai-lib');
  return { ...actual, getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token') };
});

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById(id: string) {
      return { id, path: '/tmp/test-app', name: 'test-app' };
    }
  },
}));

vi.mock('../media-search-tool.js', () => ({
  MediaSearchTool: class {
    searchMedia = vi.fn();
  },
}));

vi.mock('../../services/MediaManifestService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/MediaManifestService.js');
  return {
    ...actual,
    mediaManifestService: {
      importChatUploadToSlot: importChatUploadToSlotMock,
    },
  };
});

import { MediaSlotTool } from '../media-slot-tool.js';

const APP_ID = 'test-app-id';

function imageSlot(): MediaSlot {
  return {
    mediaType: 'image',
    currentUrl: '/airo-assets/uploads/uploads-hero-photo-abcd1234.jpg',
    searchQuery: '',
    alternatives: [],
    userModified: true,
  };
}

describe('MediaSlotTool.importUpload', () => {
  let tool: MediaSlotTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new MediaSlotTool();
  });

  it('registers a chat upload into a slot and returns the slot URL', async () => {
    importChatUploadToSlotMock.mockResolvedValue({
      success: true,
      slotPath: 'pages/home/hero',
      slotUrl: '/airo-assets/images/pages/home/hero',
      uploadedUrl: '/airo-assets/uploads/uploads-hero-photo-abcd1234.jpg',
      slot: imageSlot(),
    });

    const result = await tool.importUpload({
      slot: 'pages/home/hero',
      filename: 'stored-hero.jpg',
      appId: APP_ID,
    });

    expect(importChatUploadToSlotMock).toHaveBeenCalledWith(APP_ID, {
      filename: 'stored-hero.jpg',
      slotName: 'pages/home/hero',
      createIfMissing: true,
    });
    expect(result).toMatchObject({
      success: true,
      slot: 'pages/home/hero',
      slotUrl: '/airo-assets/images/pages/home/hero',
      mediaType: 'image',
      uploadedUrl: '/airo-assets/uploads/uploads-hero-photo-abcd1234.jpg',
    });
  });

  it('normalizes leading/trailing slashes in the slot path before importing', async () => {
    importChatUploadToSlotMock.mockResolvedValue({
      success: true,
      slotPath: 'pages/home/hero',
      slotUrl: '/airo-assets/images/pages/home/hero',
      uploadedUrl: '/airo-assets/uploads/x.jpg',
      slot: imageSlot(),
    });

    await tool.importUpload({ slot: '/pages/home/hero/', filename: 'x.jpg', appId: APP_ID });

    expect(importChatUploadToSlotMock).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({ slotName: 'pages/home/hero' }),
    );
  });

  it('reports mediaType "video" when the resolved slot is a video', async () => {
    importChatUploadToSlotMock.mockResolvedValue({
      success: true,
      slotPath: 'pages/home/hero',
      slotUrl: '/airo-assets/videos/pages/home/hero',
      uploadedUrl: '/airo-assets/uploads/clip.mp4',
      slot: { ...imageSlot(), mediaType: 'video' },
    });

    const result = await tool.importUpload({ slot: 'pages/home/hero', filename: 'clip.mp4', appId: APP_ID });

    expect(result.success).toBe(true);
    expect(result.mediaType).toBe('video');
    expect(result.slotUrl).toBe('/airo-assets/videos/pages/home/hero');
  });

  it('returns an error without calling the service when the slot path is empty', async () => {
    const result = await tool.importUpload({ slot: '   ', filename: 'x.jpg', appId: APP_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Slot path is required');
    expect(importChatUploadToSlotMock).not.toHaveBeenCalled();
  });

  it('propagates failures from the manifest service', async () => {
    importChatUploadToSlotMock.mockResolvedValue({
      success: false,
      error: 'Upload file not found',
      httpStatus: 404,
    });

    const result = await tool.importUpload({ slot: 'pages/home/hero', filename: 'missing.jpg', appId: APP_ID });

    expect(result.success).toBe(false);
    expect(result.slot).toBe('pages/home/hero');
    expect(result.slotUrl).toBe('');
    expect(result.error).toBe('Upload file not found');
  });
});
