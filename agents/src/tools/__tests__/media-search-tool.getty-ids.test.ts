import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-lib-tools/drivers/getty-media-driver.js', () => ({
  GettyMediaDriver: vi.fn().mockImplementation(() => ({
    search: vi.fn(),
  })),
}));

vi.mock('../ai-lib-tools/drivers/image-search-service-driver.js', () => ({
  ImageSearchServiceDriver: vi.fn().mockImplementation(() => ({
    search: vi.fn(),
  })),
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
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
