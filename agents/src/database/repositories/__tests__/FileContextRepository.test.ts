/**
 * FileContextRepository Test Suite
 * 
 * Comprehensive tests for the FileContextRepository class covering:
 * - Database CRUD operations for file context
 * - Data persistence and retrieval
 * - Query performance and indexing
 * - Cleanup and maintenance operations
 * - Error handling and edge cases
 * - Data consistency and integrity
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileContextRepository } from '../FileContextRepository.js';
import type { FileContext } from '../../schema.js';

// Mock database connection
vi.mock('../../connection.js');
vi.mock('crypto');

describe('FileContextRepository', () => {
  let repository: FileContextRepository;
  let mockDb: any;
  let mockStatement: any;

  // Test data
  const testAppPath = '/tmp/test-app';
  const testFilePath = 'src/components/Button.tsx';
  const testFileContext: Omit<FileContext, 'id' | 'createdAt' | 'updatedAt'> = {
    appPath: testAppPath,
    filePath: testFilePath,
    lastModified: Date.now() - 1000,
    lastRead: Date.now() - 500,
    modificationCount: 3,
    readCount: 5,
    fileSize: 1024,
    tokenCount: 50,
    contentHash: 'abc123def456',
    actualFileModTime: 1704110400000 // 2024-01-01T12:00:00Z
  };

  const mockDbRow = {
    id: 'file-ctx-123',
    app_path: testAppPath,
    file_path: testFilePath,
    last_modified: testFileContext.lastModified,
    last_read: testFileContext.lastRead,
    modification_count: testFileContext.modificationCount,
    read_count: testFileContext.readCount,
    file_size: testFileContext.fileSize,
    token_count: testFileContext.tokenCount,
    content_hash: testFileContext.contentHash,
    actual_file_mod_time: testFileContext.actualFileModTime,
    created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
    updated_at: new Date('2024-01-01T10:30:00Z').toISOString()
  };

  const expectedFileContext: FileContext = {
    id: 'file-ctx-123',
    appPath: testAppPath,
    filePath: testFilePath,
    lastModified: testFileContext.lastModified,
    lastRead: testFileContext.lastRead,
    modificationCount: testFileContext.modificationCount,
    readCount: testFileContext.readCount,
    fileSize: testFileContext.fileSize,
    tokenCount: testFileContext.tokenCount,
    contentHash: testFileContext.contentHash,
    actualFileModTime: testFileContext.actualFileModTime,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:30:00Z')
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock database statement
    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn()
    };

    // Mock database connection
    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement)
    };

    // Mock getDatabase
    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    // Mock crypto for UUID generation
    const crypto = await import('crypto');
    vi.mocked(crypto.randomUUID).mockReturnValue('file-ctx-123');

    // Create repository instance
    repository = new FileContextRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with database connection', () => {
      expect(repository).toBeInstanceOf(FileContextRepository);
      expect(mockDb).toBeDefined();
    });
  });

  describe('findByPath', () => {
    it('should return file context when found', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findByPath(testAppPath, testFilePath);

      expect(result).toEqual(expectedFileContext);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM file_context'));
      expect(mockStatement.get).toHaveBeenCalledWith(testAppPath, testFilePath);
    });

    it('should return null when file context not found', () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = repository.findByPath(testAppPath, 'nonexistent.ts');

      expect(result).toBeNull();
      expect(mockStatement.get).toHaveBeenCalledWith(testAppPath, 'nonexistent.ts');
    });

    it('should handle null actualFileModTime correctly', () => {
      const rowWithoutModTime = {
        ...mockDbRow,
        actual_file_mod_time: null
      };
      mockStatement.get.mockReturnValue(rowWithoutModTime);

      const result = repository.findByPath(testAppPath, testFilePath);

      expect(result?.actualFileModTime).toBeNull();
    });
  });

  describe('findByAppPath', () => {
    it('should return all file contexts for an app ordered by priority', () => {
      const mockRows = [
        mockDbRow,
        {
          ...mockDbRow,
          id: 'file-ctx-456',
          file_path: 'src/pages/Home.tsx',
          modification_count: 1,
          read_count: 2
        }
      ];
      mockStatement.all.mockReturnValue(mockRows);

      const results = repository.findByAppPath(testAppPath);

      expect(results).toHaveLength(2);
      expect(results[0].filePath).toBe(testFilePath);
      expect(results[1].filePath).toBe('src/pages/Home.tsx');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY modification_count DESC'));
      expect(mockStatement.all).toHaveBeenCalledWith(testAppPath);
    });

    it('should support limit parameter', () => {
      mockStatement.all.mockReturnValue([mockDbRow]);

      repository.findByAppPath(testAppPath, 5);

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT 5'));
    });

    it('should return empty array when no contexts found', () => {
      mockStatement.all.mockReturnValue([]);

      const results = repository.findByAppPath('nonexistent-app');

      expect(results).toEqual([]);
    });
  });

  describe('upsert', () => {
    describe('when file context does not exist', () => {
      beforeEach(() => {
        mockStatement.get.mockReturnValue(undefined); // Not found initially
        mockStatement.run.mockReturnValue({ changes: 1 });
      });

      it('should create new file context record', () => {
        // Mock that after insert, we can find the record
        mockStatement.get.mockReturnValueOnce(undefined).mockReturnValueOnce(mockDbRow);

        const result = repository.upsert(testFileContext);

        expect(mockStatement.run).toHaveBeenCalledWith(
          'file-ctx-123',
          testAppPath,
          testFilePath,
          testFileContext.lastModified,
          testFileContext.lastRead,
          testFileContext.modificationCount,
          testFileContext.readCount,
          testFileContext.fileSize,
          testFileContext.tokenCount,
          testFileContext.contentHash,
          testFileContext.actualFileModTime
        );
        expect(result).toEqual(expectedFileContext);
      });

      it('should handle null actualFileModTime in insert', () => {
        const contextWithoutModTime = { ...testFileContext, actualFileModTime: null };
        mockStatement.get.mockReturnValueOnce(undefined).mockReturnValueOnce({
          ...mockDbRow,
          actual_file_mod_time: null
        });

        repository.upsert(contextWithoutModTime);

        expect(mockStatement.run).toHaveBeenCalledWith(
          expect.any(String),
          testAppPath,
          testFilePath,
          testFileContext.lastModified,
          testFileContext.lastRead,
          testFileContext.modificationCount,
          testFileContext.readCount,
          testFileContext.fileSize,
          testFileContext.tokenCount,
          testFileContext.contentHash,
          null
        );
      });
    });

    describe('when file context exists', () => {
      beforeEach(() => {
        mockStatement.get.mockReturnValue(mockDbRow); // Found existing
        mockStatement.run.mockReturnValue({ changes: 1 });
      });

      it('should update existing file context record', () => {
        const updatedContext = {
          ...testFileContext,
          lastModified: Date.now(),
          modificationCount: 4,
          tokenCount: 75
        };

        const result = repository.upsert(updatedContext);

        expect(mockStatement.run).toHaveBeenCalledWith(
          updatedContext.lastModified,
          updatedContext.lastRead,
          updatedContext.modificationCount,
          updatedContext.readCount,
          updatedContext.fileSize,
          updatedContext.tokenCount,
          updatedContext.contentHash,
          updatedContext.actualFileModTime,
          'file-ctx-123'
        );
        expect(result).toEqual(expectedFileContext);
      });

      it('should handle null actualFileModTime in update', () => {
        const contextWithoutModTime = { ...testFileContext, actualFileModTime: null };
        
        repository.upsert(contextWithoutModTime);

        expect(mockStatement.run).toHaveBeenCalledWith(
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
          expect.any(String),
          null,
          'file-ctx-123'
        );
      });
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete old file context records', () => {
      const cutoffTimestamp = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
      mockStatement.run.mockReturnValue({ changes: 3 });

      const deletedCount = repository.deleteOlderThan(testAppPath, cutoffTimestamp);

      expect(deletedCount).toBe(3);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM file_context'));
      expect(mockStatement.run).toHaveBeenCalledWith(testAppPath, cutoffTimestamp);
    });

    it('should return 0 when no records to delete', () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      const deletedCount = repository.deleteOlderThan(testAppPath, Date.now());

      expect(deletedCount).toBe(0);
    });
  });

  describe('deleteByAppPath', () => {
    it('should delete all file contexts for an app', () => {
      mockStatement.run.mockReturnValue({ changes: 5 });

      const deletedCount = repository.deleteByAppPath(testAppPath);

      expect(deletedCount).toBe(5);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM file_context WHERE app_path = ?'));
      expect(mockStatement.run).toHaveBeenCalledWith(testAppPath);
    });
  });

  describe('getTotalTokenCount', () => {
    it('should return sum of token counts for app', () => {
      mockStatement.get.mockReturnValue({ total: 1250 });

      const totalTokens = repository.getTotalTokenCount(testAppPath);

      expect(totalTokens).toBe(1250);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SUM(token_count)'));
      expect(mockStatement.get).toHaveBeenCalledWith(testAppPath);
    });

    it('should return 0 when no tokens found', () => {
      mockStatement.get.mockReturnValue({ total: null });

      const totalTokens = repository.getTotalTokenCount(testAppPath);

      expect(totalTokens).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', () => {
      const mockStatsRow = {
        total_files: 10,
        total_tokens: 2500,
        last_access_time: '2024-01-01T12:00:00Z'
      };
      mockStatement.get.mockReturnValue(mockStatsRow);

      const stats = repository.getStats(testAppPath);

      expect(stats).toEqual({
        totalFiles: 10,
        totalTokens: 2500,
        lastAccessTime: new Date('2024-01-01T12:00:00Z')
      });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('COUNT(*)'));
      expect(mockStatement.get).toHaveBeenCalledWith(testAppPath);
    });

    it('should handle null values in stats', () => {
      const mockStatsRow = {
        total_files: 0,
        total_tokens: null,
        last_access_time: null
      };
      mockStatement.get.mockReturnValue(mockStatsRow);

      const stats = repository.getStats(testAppPath);

      expect(stats).toEqual({
        totalFiles: 0,
        totalTokens: 0,
        lastAccessTime: null
      });
    });
  });

  describe('Query Performance', () => {
    it('should use proper indexes for app-based queries', () => {
      mockStatement.all.mockReturnValue([]);

      repository.findByAppPath(testAppPath);

      // Verify the query includes the indexed fields
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_path = ?')
      );
    });

    it('should use proper indexes for time-based queries', () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      repository.deleteOlderThan(testAppPath, Date.now());

      // Verify the query includes the indexed fields
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('last_read < ?')
      );
    });

    it('should order results by priority fields', () => {
      mockStatement.all.mockReturnValue([]);

      repository.findByAppPath(testAppPath);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY modification_count DESC, read_count DESC, last_read DESC')
      );
    });
  });

  describe('Data Consistency', () => {
    it('should maintain consistent field mapping between database and model', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findByPath(testAppPath, testFilePath);

      // Verify all fields are properly mapped
      expect(result).toEqual(expect.objectContaining({
        id: 'file-ctx-123',
        appPath: testAppPath,
        filePath: testFilePath,
        lastModified: expect.any(Number),
        lastRead: expect.any(Number),
        modificationCount: expect.any(Number),
        readCount: expect.any(Number),
        fileSize: expect.any(Number),
        tokenCount: expect.any(Number),
        contentHash: expect.any(String),
        actualFileModTime: expect.any(Number),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      }));
    });

    it('should handle database constraint violations gracefully', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('UNIQUE constraint failed: file_context.app_path, file_context.file_path');
      });

      expect(() => {
        repository.upsert(testFileContext);
      }).toThrow('UNIQUE constraint failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers correctly', () => {
      const largeNumberContext = {
        ...testFileContext,
        lastModified: Number.MAX_SAFE_INTEGER - 1,
        lastRead: Number.MAX_SAFE_INTEGER - 2,
        fileSize: 999999999,
        tokenCount: 1000000
      };

      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ changes: 1 });

      expect(() => {
        repository.upsert(largeNumberContext);
      }).not.toThrow();
    });

    it('should handle special characters in file paths', () => {
      const specialCharContext = {
        ...testFileContext,
        filePath: 'src/components/测试-file$with[special].tsx'
      };

      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ changes: 1 });

      expect(() => {
        repository.upsert(specialCharContext);
      }).not.toThrow();
    });

    it('should handle empty content hash', () => {
      const emptyHashContext = {
        ...testFileContext,
        contentHash: ''
      };

      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ changes: 1 });

      expect(() => {
        repository.upsert(emptyHashContext);
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should propagate database errors', () => {
      mockStatement.get.mockImplementation(function () {
        throw new Error('Database connection lost');
      });

      expect(() => {
        repository.findByPath(testAppPath, testFilePath);
      }).toThrow('Database connection lost');
    });

    it('should handle malformed database rows', () => {
      const malformedRow = {
        id: 'file-ctx-123',
        app_path: testAppPath,
        // Missing required fields
      };
      mockStatement.get.mockReturnValue(malformedRow);

      expect(() => {
        repository.findByPath(testAppPath, testFilePath);
      }).not.toThrow(); // Should handle gracefully
    });
  });
});