/**
 * Working FileContextManager Test Suite
 * 
 * Tests for the FileContextManager class with properly configured mocks
 * using the vi.doMock approach that ensures mocks are applied before module imports.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FileContextManager', () => {
  let FileContextManager: any;
  let fileContextManager: any;
  let mockRepository: any;

  beforeEach(async () => {
    // Clear previous mocks
    vi.resetModules();

    // Set up all mocks BEFORE importing the module
    vi.doMock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true)
    }));

    vi.doMock('fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue('export const Button = () => <button>Click me</button>;'),
      stat: vi.fn().mockResolvedValue({
        size: 1024,
        mtime: new Date('2024-01-01T12:00:00Z')
      })
    }));

    vi.doMock('path', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        basename: vi.fn().mockImplementation((path) => path.split('/').pop())
      };
    });

    vi.doMock('../../utils/safe-path.js', () => ({
      createSafePathBuilder: vi.fn().mockReturnValue({
        resolve: vi.fn().mockImplementation((path) => `/tmp/test-app/${path}`)
      })
    }));

    vi.doMock('../../utils/token-counter.js', () => ({
      countTokens: vi.fn().mockResolvedValue({ tokenCount: 50, provider: 'anthropic', normalizedModelName: 'claude-sonnet-4-5' })
    }));

    vi.doMock('../../logging/index.js', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
    }));

    // Mock repository
    mockRepository = {
      findByPath: vi.fn(),
      findByAppPath: vi.fn().mockReturnValue([]),
      upsert: vi.fn(),
      deleteOlderThan: vi.fn().mockReturnValue(0),
      getStats: vi.fn().mockReturnValue({
        totalFiles: 0,
        totalTokens: 0,
        lastAccessTime: null
      })
    };

    vi.doMock('../../database/repositories/FileContextRepository.js', () => ({
      FileContextRepository: vi.fn().mockImplementation(() => mockRepository)
    }));

    vi.doMock('crypto', () => ({
      createHash: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue('abc123')
      })
    }));

    // Import the module after mocks are set up
    const module = await import('../FileContextManager.js');
    FileContextManager = module.FileContextManager;
    
    fileContextManager = new FileContextManager('/tmp/test-app');
  });

  describe('Initialization', () => {
    it('should initialize correctly', () => {
      expect(fileContextManager).toBeInstanceOf(FileContextManager);
    });

    it('should initialize with custom configuration', () => {
      const customConfig = {
        maxTokens: 50000,
        maxFileSize: 2 * 1024 * 1024,
        recencyWindowMs: 20 * 60 * 1000,
        minModificationCount: 5,
        minReadCount: 3
      };
      
      const customManager = new FileContextManager('/tmp/test-app', customConfig);
      expect(customManager).toBeInstanceOf(FileContextManager);
    });
  });

  describe('File Tracking Operations', () => {
    describe('recordFileModification', () => {
      it('should create new file context record for first modification', () => {
        mockRepository.findByPath.mockReturnValue(null);
        mockRepository.upsert.mockReturnValue({
          id: 'file-1',
          appPath: '/tmp/test-app',
          filePath: 'test.ts',
          lastModified: expect.any(Number),
          lastRead: 0,
          modificationCount: 1,
          readCount: 0,
          fileSize: 0,
          tokenCount: 0,
          contentHash: '',
          actualFileModTime: null
        });

        fileContextManager.recordFileModification('test.ts', true);

        expect(mockRepository.findByPath).toHaveBeenCalledWith('/tmp/test-app', 'test.ts');
        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: '/tmp/test-app',
          filePath: 'test.ts',
          lastModified: expect.any(Number),
          lastRead: 0,
          modificationCount: 1,
          readCount: 0,
          fileSize: 0,
          tokenCount: 0,
          contentHash: '',
          actualFileModTime: null
        });
      });

      it('should update existing file context record', () => {
        const existingContext = {
          id: 'file-1',
          appPath: '/tmp/test-app',
          filePath: 'test.ts',
          lastModified: Date.now() - 5000,
          lastRead: Date.now() - 3000,
          modificationCount: 3,
          readCount: 5,
          fileSize: 1024,
          tokenCount: 50,
          contentHash: 'abc123',
          actualFileModTime: null
        };
        
        mockRepository.findByPath.mockReturnValue(existingContext);
        mockRepository.upsert.mockReturnValue(existingContext);

        fileContextManager.recordFileModification('test.ts', true);

        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: existingContext.appPath,
          filePath: existingContext.filePath,
          lastModified: expect.any(Number),
          lastRead: existingContext.lastRead,
          modificationCount: 4, // incremented
          readCount: existingContext.readCount,
          fileSize: existingContext.fileSize,
          tokenCount: existingContext.tokenCount,
          contentHash: existingContext.contentHash,
          actualFileModTime: existingContext.actualFileModTime
        });
      });

      it('should not record failed modifications', () => {
        fileContextManager.recordFileModification('test.ts', false);

        expect(mockRepository.findByPath).not.toHaveBeenCalled();
        expect(mockRepository.upsert).not.toHaveBeenCalled();
      });
    });

    describe('recordFileRead', () => {
      it('should create new file context record for first read', () => {
        mockRepository.findByPath.mockReturnValue(null);
        mockRepository.upsert.mockReturnValue({
          id: 'file-1',
          appPath: '/tmp/test-app',
          filePath: 'test.ts'
        });

        fileContextManager.recordFileRead('test.ts');

        expect(mockRepository.findByPath).toHaveBeenCalledWith('/tmp/test-app', 'test.ts');
        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: '/tmp/test-app',
          filePath: 'test.ts',
          lastModified: 0,
          lastRead: expect.any(Number),
          modificationCount: 0,
          readCount: 1,
          fileSize: 0,
          tokenCount: 0,
          contentHash: '',
          actualFileModTime: null
        });
      });

      it('should update existing file context record', () => {
        const existingContext = {
          id: 'file-1',
          appPath: '/tmp/test-app',
          filePath: 'test.ts',
          lastModified: Date.now() - 5000,
          lastRead: Date.now() - 3000,
          modificationCount: 3,
          readCount: 5,
          fileSize: 1024,
          tokenCount: 50,
          contentHash: 'abc123',
          actualFileModTime: null
        };
        
        mockRepository.findByPath.mockReturnValue(existingContext);
        mockRepository.upsert.mockReturnValue(existingContext);

        fileContextManager.recordFileRead('test.ts');

        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: existingContext.appPath,
          filePath: existingContext.filePath,
          lastModified: existingContext.lastModified,
          lastRead: expect.any(Number),
          modificationCount: existingContext.modificationCount,
          readCount: 6, // incremented
          fileSize: existingContext.fileSize,
          tokenCount: existingContext.tokenCount,
          contentHash: existingContext.contentHash,
          actualFileModTime: existingContext.actualFileModTime
        });
      });
    });
  });

  describe('Hot Files Context Generation', () => {
    it('should return empty string when no hot files', async () => {
      mockRepository.findByAppPath.mockReturnValue([]);
      
      const context = await fileContextManager.getHotFilesContext();
      
      expect(context).toBe('');
    });

    it('should generate context for hot files', async () => {
      const now = Date.now();
      const hotFile = {
        id: 'file-1',
        appPath: '/tmp/test-app',
        filePath: 'components/Button.tsx',
        lastModified: now - 1000, // Recent (within 10 min window)
        lastRead: now - 500, // Recent
        modificationCount: 5, // High (exceeds min 3)
        readCount: 3, // High (exceeds min 2)
        fileSize: 1024,
        tokenCount: 50,
        contentHash: 'abc123',
        actualFileModTime: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      mockRepository.findByAppPath.mockReturnValue([hotFile]);

      const context = await fileContextManager.getHotFilesContext();
      
      expect(context).toContain('[Hot Files Context - Recently Modified/Read Files]');
      expect(context).toContain('components/Button.tsx');
      expect(context).toContain('5 edits, 3 reads');
      expect(context).toContain('export const Button = () => <button>Click me</button>;');
    });

    it('should exclude binary files', async () => {
      const now = Date.now();
      const regularFile = {
        id: 'file-1',
        appPath: '/tmp/test-app',
        filePath: 'components/Button.tsx',
        lastModified: now - 1000,
        lastRead: now - 500,
        modificationCount: 5,
        readCount: 3,
        fileSize: 1024,
        tokenCount: 50,
        contentHash: 'abc123',
        actualFileModTime: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const binaryFile = {
        id: 'file-2',
        appPath: '/tmp/test-app',
        filePath: 'assets/image.png', // Binary file
        lastModified: now - 1000,
        lastRead: now - 500,
        modificationCount: 10,
        readCount: 5,
        fileSize: 2048,
        tokenCount: 0,
        contentHash: 'def456',
        actualFileModTime: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      mockRepository.findByAppPath.mockReturnValue([regularFile, binaryFile]);

      const context = await fileContextManager.getHotFilesContext();
      
      expect(context).toContain('components/Button.tsx');
      expect(context).not.toContain('image.png');
    });
  });

  describe('Cleanup and Maintenance', () => {
    describe('pruneOldEntries', () => {
      it('should remove old entries from database', () => {
        mockRepository.deleteOlderThan.mockReturnValue(3);

        fileContextManager.pruneOldEntries();

        expect(mockRepository.deleteOlderThan).toHaveBeenCalledWith(
          '/tmp/test-app',
          expect.any(Number)
        );
      });
    });

    describe('getSummary', () => {
      it('should return accurate summary statistics', () => {
        const mockStats = {
          totalFiles: 5,
          totalTokens: 1500,
          lastAccessTime: new Date()
        };
        
        mockRepository.getStats.mockReturnValue(mockStats);
        mockRepository.findByAppPath.mockReturnValue([
          { id: 'file-1', modificationCount: 5, readCount: 3 },
          { id: 'file-2', modificationCount: 2, readCount: 1 } // This won't qualify as hot
        ]);

        const summary = fileContextManager.getSummary();

        expect(summary).toEqual({
          totalFiles: 5,
          hotFiles: 1, // Only file-1 qualifies (has >= 3 modifications and >= 2 reads)
          totalTokensUsed: 1500
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', async () => {
      const now = Date.now();
      const hotFile = {
        id: 'file-1',
        appPath: '/tmp/test-app',
        filePath: 'nonexistent.ts',
        lastModified: now - 1000,
        lastRead: now - 500,
        modificationCount: 5,
        readCount: 3,
        fileSize: 1024,
        tokenCount: 50,
        contentHash: 'abc123',
        actualFileModTime: null
      };
      
      mockRepository.findByAppPath.mockReturnValue([hotFile]);

      // Mock file system error
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const context = await fileContextManager.getHotFilesContext();

      // Should handle missing files gracefully and return empty context
      expect(context).toBe('');
    });
  });
});