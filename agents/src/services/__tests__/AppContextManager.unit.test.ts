import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the module under test
vi.mock('../../database/repositories/AppRepository.js');
vi.mock('../../tools/directory-listing.js');
vi.mock('../../tools/app-plan-tool.js');
vi.mock('../../logging/index.js', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: l,
    Logger: { create: vi.fn().mockReturnValue(l) },
  };
});
vi.mock('../../logging/events/index.js', () => ({
  appContextEvents: {
    generateBegin: vi.fn(),
    generateSuccess: vi.fn(),
    generateFailure: vi.fn(),
    packageBegin: vi.fn(),
    packageSuccess: vi.fn(),
    packageFailure: vi.fn(),
  },
  toolDirectoryListingEvents: {
    listingBegin: vi.fn(),
    listingSuccess: vi.fn(),
    listingFailure: vi.fn(),
  },
}));
vi.mock('../../tools/secrets-management-tool.js');
vi.mock('../../utils/dev-supervisor-client-factory.js');
vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: {
    getManifest: vi.fn().mockResolvedValue({ success: false }),
  },
}));
vi.mock('../../database/connection.js', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }),
  }),
}));

import { AppContextManager } from '../AppContextManager.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

describe('AppContextManager publish state', () => {
  let manager: AppContextManager;
  let mockFindById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById = vi.fn();
    vi.mocked(AppRepository).mockImplementation(() => ({
      findById: mockFindById,
    }) as any);
    manager = new AppContextManager();
  });

  describe('getPublishStateInfo', () => {
    it('should return publishedUrl when app has one', async () => {
      mockFindById.mockReturnValue({ publishedUrl: 'https://example.com' });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: 'https://example.com' });
    });

    it('should return publishedUrl null when app has no published_url', async () => {
      mockFindById.mockReturnValue({ publishedUrl: undefined });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: null });
    });

    it('should return publishedUrl null when app has empty string published_url', async () => {
      mockFindById.mockReturnValue({ publishedUrl: '' });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: null });
    });

    it('should return null when app not found', async () => {
      mockFindById.mockReturnValue(null);
      const result = await (manager as any).getPublishStateInfo('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null and warn on error', async () => {
      mockFindById.mockImplementation(() => { throw new Error('db failure'); });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toBeNull();
    });
  });

  describe('formatPublishStateSection', () => {
    it('should format published app with URL', () => {
      const result = (manager as any).formatPublishStateSection({ publishedUrl: 'https://example.com' });
      expect(result).toContain('Published: yes');
      expect(result).toContain('URL: https://example.com');
    });

    it('should format unpublished app', () => {
      const result = (manager as any).formatPublishStateSection({ publishedUrl: null });
      expect(result).toContain('Published: no');
      expect(result).not.toContain('URL:');
    });

    it('should return null when input is null', () => {
      const result = (manager as any).formatPublishStateSection(null);
      expect(result).toBeNull();
    });
  });
});
