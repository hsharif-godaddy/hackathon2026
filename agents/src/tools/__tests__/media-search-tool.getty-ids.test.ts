import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-lib-tools/drivers/getty-media-driver.js', () => ({
  GettyMediaDriver: vi.fn().mockImplementation(function () { return {
    search: vi.fn(),
  }; }),
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: { create: vi.fn(function () { return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }; }) },
}));

vi.mock('../../logging/events/index.js', () => ({
  toolImageSearchEvents: { begin: vi.fn(), success: vi.fn(), failure: vi.fn() },
  toolVideoSearchEvents: { begin: vi.fn(), success: vi.fn(), failure: vi.fn() },
  toolImageGenerationEvents: { begin: vi.fn(), success: vi.fn(), failure: vi.fn() },
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(),
}));

vi.mock('@airo/ai-lib', () => ({
  createOpenAIClient: vi.fn(),
}));

import { GettyMediaDriver } from '../ai-lib-tools/drivers/getty-media-driver.js';
import { MediaSearchTool } from '../media-search-tool.js';

describe('MediaSearchTool Getty ID tracking', () => {
  let tool: MediaSearchTool;
  let mockDriverSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new MediaSearchTool();
    const mockDriverInstance = vi.mocked(GettyMediaDriver).mock.results[0]?.value;
    mockDriverSearch = mockDriverInstance.search;
  });

  it('single image search returns gettyId', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [
        {
          id: 'getty-123',
          urls: { standard: 'https://media.gettyimages.com/foo.jpg' },
        },
      ],
    });

    const result = await tool.searchMedia('test query', 'image', 1);

    expect(result.success).toBe(true);
    expect(result.url).toBe('https://media.gettyimages.com/foo.jpg');
    expect(result.gettyId).toBe('getty-123');
  });

  it('multiple image search returns gettyIds', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [
        { id: 'getty-1', urls: { standard: 'https://media.gettyimages.com/1.jpg' } },
        { id: 'getty-2', urls: { standard: 'https://media.gettyimages.com/2.jpg' } },
        { id: 'getty-3', urls: { standard: 'https://media.gettyimages.com/3.jpg' } },
      ],
    });

    const result = await tool.searchMedia('test query', 'image', 3);

    expect(result.success).toBe(true);
    expect(result.urls).toEqual([
      'https://media.gettyimages.com/1.jpg',
      'https://media.gettyimages.com/2.jpg',
      'https://media.gettyimages.com/3.jpg',
    ]);
    expect(result.gettyIds).toEqual(['getty-1', 'getty-2', 'getty-3']);
  });

  it('video search returns gettyId', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [
        {
          id: 'getty-vid-1',
          urls: { standard: 'https://media.gettyimages.com/vid.mp4' },
        },
      ],
    });

    const result = await tool.searchMedia('test query', 'video', 1);

    expect(result.success).toBe(true);
    expect(result.gettyId).toBe('getty-vid-1');
  });

  it('failed search has no Getty IDs', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: false,
      error: 'No images found',
    });

    const result = await tool.searchMedia('test query', 'image', 1);

    expect(result.success).toBe(false);
    expect(result.gettyId).toBeUndefined();
    expect(result.gettyIds).toBeUndefined();
  });
});

describe('MediaSearchTool video thumbnail URL selection', () => {
  let tool: MediaSearchTool;
  let mockDriverSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new MediaSearchTool();
    const mockDriverInstance = vi.mocked(GettyMediaDriver).mock.results[0]?.value;
    mockDriverSearch = mockDriverInstance.search;
  });

  it('prefers thumbnail (still image) over standard mp4 and preview mp4', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [{
        id: 'v1',
        urls: {
          thumbnail: 'https://cdn.getty.com/thumb.jpg',
          standard: 'https://cdn.getty.com/vid.mp4',
          preview: 'https://cdn.getty.com/prev.mp4',
        },
      }],
    });

    const result = await tool.searchMedia('sunset', 'video', 1);

    expect(result.success).toBe(true);
    expect(result.thumbnailUrl).toBe('https://cdn.getty.com/thumb.jpg');
  });

  it('skips mp4 thumbnail and falls back to still-image preview', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [{
        id: 'v2',
        urls: {
          thumbnail: 'https://cdn.getty.com/thumb.mp4',
          standard: 'https://cdn.getty.com/vid.mp4',
          preview: 'https://cdn.getty.com/still.jpg',
        },
      }],
    });

    const result = await tool.searchMedia('ocean', 'video', 1);

    expect(result.success).toBe(true);
    expect(result.thumbnailUrl).toBe('https://cdn.getty.com/still.jpg');
  });

  it('returns no thumbnailUrl when all candidates are video files', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [{
        id: 'v3',
        urls: {
          thumbnail: 'https://cdn.getty.com/clip.m4v',
          standard: 'https://cdn.getty.com/vid.mp4',
          preview: 'https://cdn.getty.com/prev.webm',
        },
      }],
    });

    const result = await tool.searchMedia('fire', 'video', 1);

    expect(result.success).toBe(true);
    expect(result.thumbnailUrl).toBeUndefined();
  });

  it('returns no thumbnailUrl and does not crash when urls are absent', async () => {
    mockDriverSearch.mockResolvedValueOnce({
      success: true,
      items: [{
        id: 'v4',
        urls: {
          standard: 'https://cdn.getty.com/vid.mp4',
        },
      }],
    });

    const result = await tool.searchMedia('rain', 'video', 1);

    expect(result.success).toBe(true);
    expect(result.thumbnailUrl).toBeUndefined();
  });
});
