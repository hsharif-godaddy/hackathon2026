import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevSupervisorError } from '../DevSupervisorClient.js';

// Mock all external dependencies before importing the module under test
vi.mock('../../database/repositories/AppRepository.js');
vi.mock('../../database/repositories/MemoryRepository.js', () => {
  return {
    MemoryRepository: class MockMemoryRepository {
      get = vi.fn().mockResolvedValue({ success: true, exists: false });
      set = vi.fn().mockResolvedValue({ success: true });
    },
  };
});
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
vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

import { AppContextManager } from '../AppContextManager.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { MemoryRepository } from '../../database/repositories/MemoryRepository.js';
import { createForWorkspace } from '../../workspace/index.js';

describe('AppContextManager publish state', () => {
  let manager: AppContextManager;
  let mockFindById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById = vi.fn();
    vi.mocked(AppRepository).mockImplementation(function () { return ({
      findById: mockFindById,
    }) as any; });
    manager = new AppContextManager();
  });

  describe('getPublishStateInfo', () => {
    it('should return publishedUrl when app has one', async () => {
      mockFindById.mockReturnValue({ publishedUrl: 'https://example.com' });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: 'https://example.com', domains: [] });
    });

    it('should return publishedUrl null when app has no published_url', async () => {
      mockFindById.mockReturnValue({ publishedUrl: undefined });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: null, domains: [] });
    });

    it('should return publishedUrl null when app has empty string published_url', async () => {
      mockFindById.mockReturnValue({ publishedUrl: '' });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: null, domains: [] });
    });

    it('should return null when app not found', async () => {
      mockFindById.mockReturnValue(null);
      const result = await (manager as any).getPublishStateInfo('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null and warn on error', async () => {
      mockFindById.mockImplementation(function () { throw new Error('db failure'); });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toBeNull();
    });

    it('should return domains when memory repo has site.domains', async () => {
      mockFindById.mockReturnValue({ publishedUrl: 'https://example.com' });
      const domains = [{ fqdn: 'example.com', isPrimary: true, status: 'active' }];
      (manager as any).memoryRepository.get.mockResolvedValueOnce({ success: true, exists: true, value: domains });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: 'https://example.com', domains });
    });

    it('should return empty domains when memory repo returns non-array value', async () => {
      mockFindById.mockReturnValue({ publishedUrl: 'https://example.com' });
      (manager as any).memoryRepository.get.mockResolvedValueOnce({ success: true, exists: true, value: 'invalid' });
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: 'https://example.com', domains: [] });
    });

    it('should return empty domains when memory repo fails', async () => {
      mockFindById.mockReturnValue({ publishedUrl: 'https://example.com' });
      (manager as any).memoryRepository.get.mockRejectedValueOnce(new Error('db error'));
      const result = await (manager as any).getPublishStateInfo('app-123');
      expect(result).toEqual({ publishedUrl: 'https://example.com', domains: [] });
    });
  });

  describe('formatPublishStateSection', () => {
    it('should format published app with URL', () => {
      const result = (manager as any).formatPublishStateSection({ publishedUrl: 'https://example.com', domains: [] });
      expect(result).toContain('Published: yes');
      expect(result).toContain('URL: https://example.com');
    });

    it('should format unpublished app', () => {
      const result = (manager as any).formatPublishStateSection({ publishedUrl: null, domains: [] });
      expect(result).toContain('Published: no');
      expect(result).not.toContain('URL:');
    });

    it('should return null when input is null', () => {
      const result = (manager as any).formatPublishStateSection(null);
      expect(result).toBeNull();
    });

    it('should include custom domains when present', () => {
      const result = (manager as any).formatPublishStateSection({
        publishedUrl: 'https://example.com',
        domains: [
          { fqdn: 'example.com', isPrimary: true, status: 'active' },
          { fqdn: 'www.example.com', isPrimary: false, status: 'provisioning' },
        ],
      });
      expect(result).toContain('Custom domains:');
      expect(result).toContain('example.com (primary), active');
      expect(result).toContain('www.example.com, provisioning');
    });
  });

  describe('getPackageInfo', () => {
    const mockView = vi.fn();
    const mockStat = vi.fn();

    beforeEach(() => {
      // checkDependenciesInstalled (invoked from getPackageInfo) calls
      // workspace.files.stat for package.json + package-lock.json. Default to
      // "both not_found" so dependenciesInstalled resolves to false; individual
      // tests can override.
      mockStat.mockReset();
      mockStat.mockImplementation(async ({ paths }: { paths: string[] }) => ({
        entries: paths.map((path) => ({ path, error: 'not_found' as const })),
      }));
      (createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
        files: { view: mockView, stat: mockStat },
      });
    });

    it('should return package info via workspace.files.view()', async () => {
      mockView.mockResolvedValue({
        path: 'package.json',
        content: JSON.stringify({
          name: 'test-app',
          version: '1.0.0',
          description: 'A test app',
          dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
          devDependencies: { vitest: '^1.0.0' },
          scripts: { dev: 'vite', build: 'vite build' },
        }),
        encoding: 'utf-8',
        lines: 12,
        size: 200,
        truncated: false,
      });

      const context = {
        metadata: { appId: 'app-123', appPath: '/app' },
      } as any;

      const result = await (manager as any).getPackageInfo(context);

      expect(createForWorkspace).toHaveBeenCalledWith('app-123', 'preview');
      expect(mockView).toHaveBeenCalledWith({ path: 'package.json', limit: 10000 });
      expect(result).toMatchObject({
        name: 'test-app',
        version: '1.0.0',
        dependencies: ['react', 'react-dom'],
        devDependencies: ['vitest'],
        scripts: ['dev', 'build'],
      });
    });

    it('should return null when workspace is unavailable', async () => {
      (createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const context = { metadata: { appId: 'app-123' } } as any;
      const result = await (manager as any).getPackageInfo(context);

      expect(result).toBeNull();
    });

    it('should return null when view throws (e.g. file not found)', async () => {
      mockView.mockRejectedValue(new DevSupervisorError('not_found', 404, 'file not found'));

      const context = { metadata: { appId: 'app-123' } } as any;
      const result = await (manager as any).getPackageInfo(context);

      expect(result).toBeNull();
    });

    it('propagates non-not-found errors instead of silently swallowing them', async () => {
      // Parse failures and supervisor outages must not be hidden behind a
      // silent null — only DevSupervisorError(not_found) is "no info."
      mockView.mockResolvedValue({
        path: 'package.json',
        content: 'not valid json {{{',
        encoding: 'utf-8',
        lines: 1,
        size: 18,
        truncated: false,
      });

      const context = { metadata: { appId: 'app-123' } } as any;
      await expect((manager as any).getPackageInfo(context)).rejects.toThrow();
    });

    it('propagates supervisor transport failures', async () => {
      mockView.mockRejectedValue(new Error('supervisor unreachable'));

      const context = { metadata: { appId: 'app-123' } } as any;
      await expect((manager as any).getPackageInfo(context))
        .rejects.toThrow('supervisor unreachable');
    });
  });

  describe('checkDependenciesInstalled', () => {
    const mockStat = vi.fn();

    type StatEntry =
      | { path: string; kind: 'file' | 'directory'; size: number; modifiedAt: string }
      | { path: string; error: 'not_found' | 'permission_denied' | 'invalid_path' };

    function statEntry(path: string, modifiedAt: string | null): StatEntry {
      return modifiedAt === null
        ? { path, error: 'not_found' as const }
        : { path, kind: 'file' as const, size: 100, modifiedAt };
    }

    function withTimes(pkgIso: string | null, lockIso: string | null): void {
      mockStat.mockResolvedValue({
        entries: [statEntry('package.json', pkgIso), statEntry('package-lock.json', lockIso)],
      });
    }

    beforeEach(() => {
      mockStat.mockReset();
      (createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
        files: { stat: mockStat },
      });
    });

    const ctx = { metadata: { appId: 'app-123' } } as any;

    it('returns true when lockfile is newer than package.json', async () => {
      withTimes('2026-06-01T00:00:00Z', '2026-06-01T00:01:00Z');
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(true);
    });

    it('returns true when lock and pkg have identical times', async () => {
      withTimes('2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(true);
    });

    it('returns true when pkg is newer than lock by <=5s (WSL2 tolerance)', async () => {
      withTimes('2026-06-01T00:00:04.900Z', '2026-06-01T00:00:00Z');
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(true);
    });

    it('returns false when pkg is newer than lock by >5s (out of tolerance)', async () => {
      withTimes('2026-06-01T00:00:05.100Z', '2026-06-01T00:00:00Z');
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(false);
    });

    it('returns false when only package.json is present', async () => {
      withTimes('2026-06-01T00:00:00Z', null);
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(false);
    });

    it('returns false when only package-lock.json is present', async () => {
      withTimes(null, '2026-06-01T00:00:00Z');
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(false);
    });

    it('returns false when both files are not_found', async () => {
      withTimes(null, null);
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(false);
    });

    it('propagates non-not-found supervisor errors instead of silently returning false', async () => {
      mockStat.mockRejectedValue(new DevSupervisorError('transport_error', 500, 'connection refused'));
      await expect((manager as any).checkDependenciesInstalled(ctx)).rejects.toThrow(DevSupervisorError);
    });

    it('calls workspace.files.stat with both filenames', async () => {
      withTimes('2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
      await (manager as any).checkDependenciesInstalled(ctx);
      expect(mockStat).toHaveBeenCalledWith({ paths: ['package.json', 'package-lock.json'] });
    });

    it('returns false when modifiedAt is malformed (NaN guard, not silent false)', async () => {
      // Malformed RFC3339 → new Date(...).getTime() === NaN.
      // Without the guard, NaN <= 5 === false would silently report
      // "not installed"; with the guard we log a warn and return false explicitly.
      withTimes('not-a-date', '2026-06-01T00:00:00Z');
      const result = await (manager as any).checkDependenciesInstalled(ctx);
      expect(result).toBe(false);
    });
  });
});
