import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppRepository } from '../AppRepository.js';
import { existsSync, rmSync } from 'fs';
import path from 'path';

// Mock all external dependencies
vi.mock('fs');
vi.mock('path');
vi.mock('../../connection.js');
vi.mock('../../../utils/git.js');
vi.mock('../../../utils/dev-supervisor-client-factory.js');
vi.mock('../../../logging/index.js');
vi.mock('../../../utils/error.js');
vi.mock('../../../logging/events/index.js', () => ({
  appCleanupEvents: { directorySuccess: vi.fn() },
}));

describe('AppRepository publishedUrl', () => {
  let appRepository: AppRepository;
  let mockDb: any;

  const baseRow = {
    id: 'app-123',
    name: 'Test App',
    path: '/tmp/apps/app-123',
    port: 3000,
    socket_path: null,
    publish_supervisor_path: null,
    preview_url: null,
    published_url: null,
    initial_prompt: null,
    template_version: 'v8',
    subscription_id: null,
    customer_id: null,
    status: 'created',
    initial_build_complete: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.SITE_ID;
    delete process.env.CUSTOMER_APP_DIR;
    delete process.env.APPS_BASE_DIR;
    delete process.env.DOC_APPS;
    delete process.env.NOMAD_ALLOC_DIR;

    mockDb = { prepare: vi.fn() };

    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    const { GitUtils } = await import('../../../utils/git.js');
    vi.mocked(GitUtils).mockImplementation(function () { return ({
      initRepository: vi.fn().mockResolvedValue({ success: true }),
      configureUser: vi.fn().mockResolvedValue(undefined),
      createInitialCommit: vi.fn().mockResolvedValue({ success: true }),
    }) as any; });

    const { DevSupervisorClientFactory } = await import('../../../utils/dev-supervisor-client-factory.js');
    vi.mocked(DevSupervisorClientFactory).createForApp = vi.fn().mockReturnValue(null);
    vi.mocked(DevSupervisorClientFactory).getAppInfo = vi.fn().mockReturnValue(null);
    vi.mocked(DevSupervisorClientFactory).isAvailableForApp = vi.fn().mockReturnValue(false);

    const { Logger } = await import('../../../logging/index.js');
    vi.mocked(Logger).create = vi.fn().mockReturnValue({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    });

    const { getErrorMessage } = await import('../../../utils/error.js');
    vi.mocked(getErrorMessage).mockImplementation(function (e: any) { return e instanceof Error ? e.message : String(e); }
    );

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(rmSync).mockReturnValue(undefined);
    vi.mocked(path.join).mockImplementation(function (...args) { return args.join('/'); });

    appRepository = new AppRepository();
  });

  describe('findById', () => {
    it('should include publishedUrl when present', () => {
      const row = { ...baseRow, published_url: 'https://my-app.example.com' };
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(row) });

      const result = appRepository.findById('app-123');
      expect(result?.publishedUrl).toBe('https://my-app.example.com');
    });

    it('should have null publishedUrl when column is null', () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(baseRow) });

      const result = appRepository.findById('app-123');
      expect(result?.publishedUrl).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should include publishedUrl in results', () => {
      const rows = [
        { ...baseRow, id: 'app-1', published_url: 'https://one.example.com' },
        { ...baseRow, id: 'app-2', published_url: null },
      ];
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });

      const results = appRepository.findAll();
      expect(results[0].publishedUrl).toBe('https://one.example.com');
      expect(results[1].publishedUrl).toBeNull();
    });
  });

  describe('findByPath', () => {
    it('should include publishedUrl when present', () => {
      const row = { ...baseRow, published_url: 'https://path-app.example.com' };
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(row) });

      const result = appRepository.findByPath('/tmp/apps/app-123');
      expect(result?.publishedUrl).toBe('https://path-app.example.com');
    });
  });

  describe('updatePublishedUrl', () => {
    it('should update published_url and return updated app', () => {
      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce(baseRow) // findById check
        .mockReturnValueOnce({ ...baseRow, published_url: 'https://new.example.com' }); // re-read
      mockDb.prepare.mockReturnValue({ get: mockGet, run: mockRun });

      const result = appRepository.updatePublishedUrl('app-123', 'https://new.example.com');
      expect(mockRun).toHaveBeenCalledWith('https://new.example.com', expect.any(String), 'app-123');
      expect(result?.publishedUrl).toBe('https://new.example.com');
    });

    it('should return null when app not found', () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const result = appRepository.updatePublishedUrl('nonexistent', 'https://x.com');
      expect(result).toBeNull();
    });

    it('should set published_url to null (clear)', () => {
      const mockRun = vi.fn();
      const mockGet = vi.fn()
        .mockReturnValueOnce({ ...baseRow, published_url: 'https://old.com' })
        .mockReturnValueOnce({ ...baseRow, published_url: null });
      mockDb.prepare.mockReturnValue({ get: mockGet, run: mockRun });

      const result = appRepository.updatePublishedUrl('app-123', null);
      expect(mockRun).toHaveBeenCalledWith(null, expect.any(String), 'app-123');
      expect(result?.publishedUrl).toBeNull();
    });

    it('should return null and warn on db error', () => {
      mockDb.prepare.mockImplementation(() => { throw new Error('db failure'); });

      const result = appRepository.updatePublishedUrl('app-123', 'https://x.com');
      expect(result).toBeNull();
    });
  });
});
