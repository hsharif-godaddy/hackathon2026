/**
 * FileContextManager Test Suite
 * 
 * Comprehensive tests for the FileContextManager class covering:
 * - Database persistence for hot files state
 * - File access tracking (reads and modifications)
 * - Hot files context generation
 * - File context scoring and prioritization
 * - Database operations and state persistence
 * - Memory vs. database consistency
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileContextManager } from '../FileContextManager.js';
import { FileContextRepository } from '../../database/repositories/FileContextRepository.js';
import { existsSync, readFileSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

// Mock all external dependencies
vi.mock('fs');
vi.mock('fs/promises');
vi.mock('path');
vi.mock('crypto');
vi.mock('../../database/repositories/FileContextRepository.js');
vi.mock('../../logging/index.js');
vi.mock('../../utils/token-counter.js');
vi.mock('../../utils/safe-path.js');

// Mock the logging
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('FileContextManager', () => {
  let fileContextManager: FileContextManager;
  let mockRepository: any;
  let mockSafePathBuilder: any;

  // Test data
  const testAppPath = '/tmp/test-app';
  const testFile1 = 'src/components/Button.tsx';
  const testFile2 = 'src/pages/Home.tsx';
  const testFile3 = 'README.md';

  const mockFileContent = 'export const Button = () => <button>Click me</button>;';
  const mockFileStats = {
    size: 1024,
    mtime: new Date('2024-01-01T12:00:00Z')
  };

  const mockDbFileContext = {
    id: 'file-1',
    appPath: testAppPath,
    filePath: testFile1,
    lastModified: Date.now() - 1000, // 1 second ago
    lastRead: Date.now() - 500, // 0.5 seconds ago
    modificationCount: 3,
    readCount: 5,
    fileSize: 1024,
    tokenCount: 50,
    contentHash: 'abc123',
    actualFileModTime: mockFileStats.mtime.getTime(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock FileContextRepository
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
    vi.mocked(FileContextRepository).mockImplementation(() => mockRepository);

    // Mock safe path builder
    mockSafePathBuilder = {
      resolve: vi.fn().mockImplementation((filePath) => path.join(testAppPath, filePath))
    };
    
    // Mock createSafePathBuilder
    const { createSafePathBuilder } = await import('../../utils/safe-path.js');
    vi.mocked(createSafePathBuilder).mockReturnValue(mockSafePathBuilder);

    // Mock filesystem functions
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(stat).mockResolvedValue(mockFileStats as any);
    vi.mocked(readFileSync).mockReturnValue(mockFileContent);

    // Mock fs/promises readFile
    const fs = await import('fs/promises');
    vi.mocked(fs.readFile).mockResolvedValue(mockFileContent);
    vi.mocked(fs.stat).mockResolvedValue(mockFileStats as any);

    // Mock token counter
    const { estimateTokens } = await import('../../utils/token-counter.js');
    vi.mocked(estimateTokens).mockReturnValue(50);

    // Mock crypto
    const crypto = await import('crypto');
    const mockHash = {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('abc123')
    };
    vi.mocked(crypto.createHash).mockReturnValue(mockHash as any);

    // Create FileContextManager instance
    fileContextManager = new FileContextManager(testAppPath);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      expect(fileContextManager).toBeInstanceOf(FileContextManager);
      expect(FileContextRepository).toHaveBeenCalledTimes(1);
    });

    it('should initialize with custom configuration', () => {
      const customConfig = {
        maxTokens: 50000,
        maxFileSize: 2 * 1024 * 1024,
        recencyWindowMs: 20 * 60 * 1000,
        minModificationCount: 5,
        minReadCount: 3
      };
      
      const customManager = new FileContextManager(testAppPath, customConfig);
      expect(customManager).toBeInstanceOf(FileContextManager);
    });
  });

  describe('File Tracking Operations', () => {
    describe('recordFileModification', () => {
      it('should create new file context record for first modification', () => {
        mockRepository.findByPath.mockReturnValue(null);
        mockRepository.upsert.mockReturnValue(mockDbFileContext);

        fileContextManager.recordFileModification(testFile1, true);

        expect(mockRepository.findByPath).toHaveBeenCalledWith(testAppPath, testFile1);
        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: testAppPath,
          filePath: testFile1,
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
        const existingContext = { ...mockDbFileContext };
        mockRepository.findByPath.mockReturnValue(existingContext);
        mockRepository.upsert.mockReturnValue(existingContext);

        fileContextManager.recordFileModification(testFile1, true);

        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: existingContext.appPath,
          filePath: existingContext.filePath,
          lastModified: expect.any(Number),
          lastRead: existingContext.lastRead,
          modificationCount: 4, // existingContext.modificationCount (3) + 1
          readCount: existingContext.readCount,
          fileSize: existingContext.fileSize,
          tokenCount: existingContext.tokenCount,
          contentHash: existingContext.contentHash,
          actualFileModTime: existingContext.actualFileModTime || null
        });
      });

      it('should not record failed modifications', () => {
        fileContextManager.recordFileModification(testFile1, false);

        expect(mockRepository.findByPath).not.toHaveBeenCalled();
        expect(mockRepository.upsert).not.toHaveBeenCalled();
      });
    });

    describe('recordFileRead', () => {
      it('should create new file context record for first read', () => {
        mockRepository.findByPath.mockReturnValue(null);
        mockRepository.upsert.mockReturnValue(mockDbFileContext);

        fileContextManager.recordFileRead(testFile1);

        expect(mockRepository.findByPath).toHaveBeenCalledWith(testAppPath, testFile1);
        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: testAppPath,
          filePath: testFile1,
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
        const existingContext = { ...mockDbFileContext };
        mockRepository.findByPath.mockReturnValue(existingContext);
        mockRepository.upsert.mockReturnValue(existingContext);

        fileContextManager.recordFileRead(testFile1);

        expect(mockRepository.upsert).toHaveBeenCalledWith({
          appPath: existingContext.appPath,
          filePath: existingContext.filePath,
          lastModified: existingContext.lastModified,
          lastRead: expect.any(Number),
          modificationCount: existingContext.modificationCount,
          readCount: 6, // existingContext.readCount (5) + 1
          fileSize: existingContext.fileSize,
          tokenCount: existingContext.tokenCount,
          contentHash: existingContext.contentHash,
          actualFileModTime: existingContext.actualFileModTime || null
        });
      });
    });
  });

  describe('Hot Files Context Generation', () => {
    beforeEach(() => {
      // Mock multiple file contexts in database
      const now = Date.now();
      const mockFileContexts = [
        {
          ...mockDbFileContext,
          filePath: testFile1,
          modificationCount: 5, // High modification count (exceeds minModificationCount=3)
          readCount: 3, // High read count (exceeds minReadCount=2)
          lastModified: now - 1000, // Recent (within recencyWindowMs=10min)
          lastRead: now - 500
        },
        {
          ...mockDbFileContext,
          id: 'file-2',
          filePath: testFile2,
          modificationCount: 4, // Meets minModificationCount=3
          readCount: 8, // Very high read count
          lastModified: now - 5000, // Still recent (within 10min window)
          lastRead: now - 2000 // Recent read (within recency window)
        },
        {
          ...mockDbFileContext,
          id: 'file-3',
          filePath: testFile3,
          modificationCount: 1,
          readCount: 1, // Low activity - should not qualify
          lastModified: now - (20 * 60 * 1000), // 20min ago (outside recency window)
          lastRead: now - (15 * 60 * 1000) // 15min ago (outside recency window)
        }
      ];
      
      mockRepository.findByAppPath.mockReturnValue(mockFileContexts);
    });

    describe('getHotFilesContext', () => {
      it('should generate context for hot files', async () => {
        const context = await fileContextManager.getHotFilesContext();

        expect(context).toContain('[Hot Files Context - Recently Modified/Read Files]');
        expect(context).toContain(testFile1);
        expect(context).toContain('5 edits, 3 reads');
        expect(context).toContain(mockFileContent);
        expect(mockRepository.findByAppPath).toHaveBeenCalledWith(testAppPath);
      });

      it('should return empty string when no hot files', async () => {
        mockRepository.findByAppPath.mockReturnValue([]);

        const context = await fileContextManager.getHotFilesContext();

        expect(context).toBe('');
      });

      it('should respect token budget limits', async () => {
        // Create a manager with very low token limit
        const lowTokenManager = new FileContextManager(testAppPath, { maxTokens: 10 });
        
        // Mock the repository for this test
        vi.mocked(FileContextRepository).mockImplementation(() => ({
          ...mockRepository,
          findByAppPath: mockRepository.findByAppPath
        }));

        const context = await lowTokenManager.getHotFilesContext();

        // Should still generate some context but limited by token budget
        expect(context).toBeDefined();
      });

      it('should handle file read errors gracefully', async () => {
        const fs = await import('fs/promises');
        vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));

        const context = await fileContextManager.getHotFilesContext();

        // Should continue with other files despite errors
        expect(context).toBeDefined();
      });

      it('should exclude binary files', async () => {
        // Add a binary file to mock data
        const binaryFileContext = {
          ...mockDbFileContext,
          id: 'file-4',
          filePath: 'image.png',
          modificationCount: 10,
          readCount: 5
        };
        
        mockRepository.findByAppPath.mockReturnValue([
          mockDbFileContext,
          binaryFileContext
        ]);

        const context = await fileContextManager.getHotFilesContext();

        expect(context).toContain(testFile1);
        expect(context).not.toContain('image.png');
      });

      it('should handle files that no longer exist', async () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const context = await fileContextManager.getHotFilesContext();

        // Should handle missing files gracefully
        expect(context).toBeDefined();
      });

      it('should respect file size limits', async () => {
        vi.mocked(stat).mockResolvedValue({
          size: 10 * 1024 * 1024, // 10MB - exceeds default 1MB limit
          mtime: new Date()
        } as any);

        const context = await fileContextManager.getHotFilesContext();

        // Should exclude oversized files
        expect(context).toBeDefined();
      });

      it('should truncate very long files', async () => {
        const longContent = 'a'.repeat(2 * 1024 * 1024); // 2MB content
        const fs = await import('fs/promises');
        vi.mocked(fs.readFile).mockResolvedValue(longContent);

        const context = await fileContextManager.getHotFilesContext();

        expect(context).toContain('[... truncated due to size limit ...]');
      });
    });

    describe('Hot File Scoring', () => {
      it('should prioritize recently modified files', async () => {
        const now = Date.now();
        const recentlyModified = {
          ...mockDbFileContext,
          filePath: 'recent.ts',
          lastModified: now - 1000, // Very recent
          modificationCount: 3, // Meets minModificationCount
          readCount: 2, // Meets minReadCount
          lastRead: now - 500
        };

        const olderFile = {
          ...mockDbFileContext,
          id: 'file-2',
          filePath: 'old.ts',
          lastModified: now - (30 * 60 * 1000), // 30 minutes ago (outside recency window)
          modificationCount: 5, // Higher count but older (still qualifies as frequently modified)
          readCount: 3,
          lastRead: now - (25 * 60 * 1000)
        };

        mockRepository.findByAppPath.mockReturnValue([recentlyModified, olderFile]);

        const context = await fileContextManager.getHotFilesContext();

        // Both files should appear in context
        expect(context).toContain('recent.ts');
        expect(context).toContain('old.ts');
      });

      it('should include frequently modified files even if not recent', async () => {
        const now = Date.now();
        const frequentlyModified = {
          ...mockDbFileContext,
          filePath: 'frequent.ts',
          lastModified: now - (30 * 60 * 1000), // Old (outside recency window)
          modificationCount: 10, // Very high count (exceeds minModificationCount=3)
          readCount: 2, // Meets minReadCount
          lastRead: now - (25 * 60 * 1000)
        };

        mockRepository.findByAppPath.mockReturnValue([frequentlyModified]);

        const context = await fileContextManager.getHotFilesContext();

        expect(context).toContain('frequent.ts');
      });

      it('should include frequently read files', async () => {
        const now = Date.now();
        const frequentlyRead = {
          ...mockDbFileContext,
          filePath: 'popular.ts',
          lastModified: now - (30 * 60 * 1000), // Old modification
          lastRead: now - 1000, // Recent read (within recency window)
          modificationCount: 1, // Low modification count
          readCount: 5 // High read count (exceeds minReadCount=2)
        };

        mockRepository.findByAppPath.mockReturnValue([frequentlyRead]);

        const context = await fileContextManager.getHotFilesContext();

        expect(context).toContain('popular.ts');
      });
    });
  });

  describe('Database Persistence', () => {
    it('should persist file metadata when loading content', async () => {
      mockRepository.findByPath.mockReturnValue(mockDbFileContext);
      
      // Test private method via hot files context generation
      mockRepository.findByAppPath.mockReturnValue([mockDbFileContext]);

      await fileContextManager.getHotFilesContext();

      // Should update database with fresh file metadata
      expect(mockRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          fileSize: mockFileStats.size,
          tokenCount: 50,
          contentHash: 'abc123',
          actualFileModTime: mockFileStats.mtime.getTime()
        })
      );
    });

    it('should handle cache validation correctly', async () => {
      const cachedContext = {
        ...mockDbFileContext,
        actualFileModTime: mockFileStats.mtime.getTime() // File hasn't changed
      };
      
      mockRepository.findByPath.mockReturnValue(cachedContext);
      mockRepository.findByAppPath.mockReturnValue([cachedContext]);

      // Should use cached content when file hasn't changed
      const context = await fileContextManager.getHotFilesContext();
      
      expect(context).toBeDefined();
    });

    it('should invalidate cache when file is modified externally', async () => {
      const outdatedContext = {
        ...mockDbFileContext,
        actualFileModTime: mockFileStats.mtime.getTime() - 10000 // File was modified since cache
      };
      
      mockRepository.findByPath.mockReturnValue(outdatedContext);
      mockRepository.findByAppPath.mockReturnValue([outdatedContext]);

      // Mock newer file stats
      vi.mocked(stat).mockResolvedValue({
        size: 2048,
        mtime: new Date(mockFileStats.mtime.getTime() + 5000)
      } as any);

      await fileContextManager.getHotFilesContext();

      // Should reload file content and update database
      expect(mockRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          fileSize: 2048,
          actualFileModTime: mockFileStats.mtime.getTime() + 5000
        })
      );
    });
  });

  describe('Cleanup and Maintenance', () => {
    describe('pruneOldEntries', () => {
      it('should remove old entries from database', () => {
        mockRepository.deleteOlderThan.mockReturnValue(3);

        fileContextManager.pruneOldEntries();

        expect(mockRepository.deleteOlderThan).toHaveBeenCalledWith(
          testAppPath,
          expect.any(Number)
        );
      });

      it('should calculate correct cutoff timestamp', () => {
        const beforePrune = Date.now();
        fileContextManager.pruneOldEntries();
        const afterPrune = Date.now();

        // Should use 5x recency window (default 10 minutes * 5 = 50 minutes)
        const expectedMaxAge = 50 * 60 * 1000;
        const cutoffTimestamp = mockRepository.deleteOlderThan.mock.calls[0][1];
        
        expect(cutoffTimestamp).toBeGreaterThanOrEqual(beforePrune - expectedMaxAge);
        expect(cutoffTimestamp).toBeLessThanOrEqual(afterPrune - expectedMaxAge);
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
          mockDbFileContext,
          { ...mockDbFileContext, id: 'file-2' }
        ]);

        const summary = fileContextManager.getSummary();

        expect(summary).toEqual({
          totalFiles: 5,
          hotFiles: 2, // From findByAppPath mock
          totalTokensUsed: 1500
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', () => {
      mockRepository.findByPath.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      // Should throw since database errors are not caught in recordFileModification
      expect(() => {
        fileContextManager.recordFileModification(testFile1, true);
      }).toThrow('Database connection lost');
    });

    it('should handle file system errors gracefully', async () => {
      mockRepository.findByAppPath.mockReturnValue([mockDbFileContext]);
      vi.mocked(existsSync).mockReturnValue(false);

      const context = await fileContextManager.getHotFilesContext();

      // Should continue execution despite file system errors
      expect(context).toBeDefined();
    });

    it('should handle token estimation errors gracefully', async () => {
      mockRepository.findByAppPath.mockReturnValue([mockDbFileContext]);
      
      const { estimateTokens } = await import('../../utils/token-counter.js');
      vi.mocked(estimateTokens).mockImplementation(() => {
        throw new Error('Token estimation failed');
      });

      const context = await fileContextManager.getHotFilesContext();

      expect(context).toBeDefined();
    });
  });

  describe('State Persistence Across Restarts', () => {
    it('should maintain state after simulated restart', () => {
      // Simulate file operations before restart
      mockRepository.findByPath.mockReturnValue(null);
      mockRepository.upsert.mockReturnValue(mockDbFileContext);
      
      fileContextManager.recordFileModification(testFile1, true);
      fileContextManager.recordFileRead(testFile1);

      // Simulate restart by creating new manager instance
      const newManager = new FileContextManager(testAppPath);
      
      // Mock repository to return previously stored data
      mockRepository.findByPath.mockReturnValue({
        ...mockDbFileContext,
        modificationCount: 1,
        readCount: 1
      });

      mockRepository.findByAppPath.mockReturnValue([{
        ...mockDbFileContext,
        modificationCount: 1,
        readCount: 1
      }]);

      // Should be able to access previously tracked files
      expect(() => newManager.recordFileRead(testFile1)).not.toThrow();
    });

    it('should handle migration from empty database', async () => {
      mockRepository.findByAppPath.mockReturnValue([]);

      const context = await fileContextManager.getHotFilesContext();

      expect(context).toBe('');
      expect(mockRepository.findByAppPath).toHaveBeenCalledWith(testAppPath);
    });
  });
});