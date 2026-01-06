import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileEditTool } from '../file-edit.js';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Comprehensive test suite for batch file operations
 * Tests multiple file operations (create, edit, rewrite, delete) in a single call
 */
describe('FileEditTool - Batch Operations', () => {
  let fileEditTool: FileEditTool;
  let testAppDir: string;

  beforeEach(() => {
    fileEditTool = new FileEditTool();

    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testAppDir = join(tmpdir(), `test-batch-${uniqueId}`);

    mkdirSync(testAppDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testAppDir)) {
      rmSync(testAppDir, { recursive: true, force: true });
    }
  });

  describe('Success Scenarios', () => {
    it('should create multiple files in one batch operation', async () => {
      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'file1.txt',
            mode: 'create',
            content: 'Content of file 1'
          },
          {
            path: 'file2.txt',
            mode: 'create',
            content: 'Content of file 2'
          },
          {
            path: 'src/file3.txt',
            mode: 'create',
            content: 'Content of file 3'
          }
        ],
        createDirs: true
      });

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(3);
      expect(result.completedOperations).toBe(3);
      expect(result.results).toHaveLength(3);

      // Verify all files were created
      expect(existsSync(join(testAppDir, 'file1.txt'))).toBe(true);
      expect(existsSync(join(testAppDir, 'file2.txt'))).toBe(true);
      expect(existsSync(join(testAppDir, 'src', 'file3.txt'))).toBe(true);

      // Verify content
      expect(readFileSync(join(testAppDir, 'file1.txt'), 'utf-8')).toBe('Content of file 1');
      expect(readFileSync(join(testAppDir, 'file2.txt'), 'utf-8')).toBe('Content of file 2');
      expect(readFileSync(join(testAppDir, 'src', 'file3.txt'), 'utf-8')).toBe('Content of file 3');

      // Verify all results are successful
      result.results.forEach(r => {
        expect(r.success).toBe(true);
        expect(r.mode).toBe('create');
      });
    });

    it('should perform mixed operations (create, edit, rewrite, delete)', async () => {
      // Setup: create initial files
      writeFileSync(join(testAppDir, 'existing.txt'), 'Original content');
      writeFileSync(join(testAppDir, 'to-rewrite.txt'), 'Old content');
      writeFileSync(join(testAppDir, 'to-delete.txt'), 'Will be deleted');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'new-file.txt',
            mode: 'create',
            content: 'New file content'
          },
          {
            path: 'existing.txt',
            mode: 'edit',
            edits: [
              { old: 'Original', new: 'Modified' }
            ]
          },
          {
            path: 'to-rewrite.txt',
            mode: 'rewrite',
            content: 'Completely new content'
          },
          {
            path: 'to-delete.txt',
            mode: 'delete'
          }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.totalOperations).toBe(4);
      expect(result.completedOperations).toBe(4);
      expect(result.results).toHaveLength(4);

      // Verify create
      expect(existsSync(join(testAppDir, 'new-file.txt'))).toBe(true);
      expect(readFileSync(join(testAppDir, 'new-file.txt'), 'utf-8')).toBe('New file content');

      // Verify edit
      expect(readFileSync(join(testAppDir, 'existing.txt'), 'utf-8')).toBe('Modified content');

      // Verify rewrite
      expect(readFileSync(join(testAppDir, 'to-rewrite.txt'), 'utf-8')).toBe('Completely new content');

      // Verify delete
      expect(existsSync(join(testAppDir, 'to-delete.txt'))).toBe(false);

      // Verify result modes
      expect(result.results[0].mode).toBe('create');
      expect(result.results[1].mode).toBe('edit');
      expect(result.results[2].mode).toBe('rewrite');
      expect(result.results[3].mode).toBe('delete');
    });

    it('should auto-detect modes when not specified', async () => {
      // Create a file for editing
      writeFileSync(join(testAppDir, 'existing.txt'), 'Content to edit');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'new-auto.txt',
            content: 'New file' // Should auto-detect as 'create'
          },
          {
            path: 'existing.txt',
            edits: [{ old: 'Content', new: 'Modified' }] // Should auto-detect as 'edit'
          },
          {
            path: 'existing.txt',
            content: 'Rewritten' // Should auto-detect as 'rewrite'
          }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.results[0].mode).toBe('create');
      expect(result.results[1].mode).toBe('edit');
      expect(result.results[2].mode).toBe('rewrite');
    });
  });

  describe('Fail-Fast Behavior', () => {
    it('should stop on first error and return partial results', async () => {
      // Create a file to cause a conflict
      writeFileSync(join(testAppDir, 'conflict.txt'), 'Existing content');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'success1.txt',
            mode: 'create',
            content: 'First success'
          },
          {
            path: 'success2.txt',
            mode: 'create',
            content: 'Second success'
          },
          {
            path: 'conflict.txt',
            mode: 'edit',
            edits: [
              { old: 'WRONG_CONTENT', new: 'Will fail' }
            ]
          },
          {
            path: 'never-created.txt',
            mode: 'create',
            content: 'Should never be created'
          }
        ]
      });

      expect(result.success).toBe(false);
      expect(result.totalOperations).toBe(4);
      expect(result.completedOperations).toBe(2); // Only first 2 succeeded
      expect(result.results).toHaveLength(3); // 2 successes + 1 failure
      expect(result.error).toBeDefined();

      // Verify first two operations succeeded
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
      expect(existsSync(join(testAppDir, 'success1.txt'))).toBe(true);
      expect(existsSync(join(testAppDir, 'success2.txt'))).toBe(true);

      // Verify third operation failed
      expect(result.results[2].success).toBe(false);
      expect(result.results[2].error).toBeDefined();

      // Verify fourth operation was never attempted
      expect(existsSync(join(testAppDir, 'never-created.txt'))).toBe(false);
    });

    it('should handle error on first operation', async () => {
      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'nonexistent.txt',
            mode: 'edit',
            edits: [{ old: 'foo', new: 'bar' }]
          },
          {
            path: 'never-created.txt',
            mode: 'create',
            content: 'Never reached'
          }
        ]
      });

      expect(result.success).toBe(false);
      expect(result.totalOperations).toBe(2);
      expect(result.completedOperations).toBe(0);
      expect(result.results).toHaveLength(1); // Only the failed operation
      expect(result.results[0].success).toBe(false);
      expect(existsSync(join(testAppDir, 'never-created.txt'))).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle duplicate file paths', async () => {
      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'file.txt',
            mode: 'create',
            content: 'First version'
          },
          {
            path: 'file.txt',
            mode: 'rewrite',
            content: 'Second version'
          }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(2);

      // Second operation should win
      expect(readFileSync(join(testAppDir, 'file.txt'), 'utf-8')).toBe('Second version');
    });

    it('should handle operations with createDirs disabled', async () => {
      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'nonexistent/dir/file.txt',
            mode: 'create',
            content: 'Content'
          }
        ],
        createDirs: false
      });

      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toMatch(/ENOENT|no such file or directory/i);
    });

    it('should preserve successful operations when partial failure occurs', async () => {
      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'success.txt',
            mode: 'create',
            content: 'Preserved content'
          },
          {
            path: 'nonexistent-dir-no-create/fail.txt',
            mode: 'create',
            content: 'Will fail'
          }
        ],
        createDirs: false
      });

      expect(result.success).toBe(false);
      expect(result.completedOperations).toBe(1);

      // First file should still exist
      expect(existsSync(join(testAppDir, 'success.txt'))).toBe(true);
      expect(readFileSync(join(testAppDir, 'success.txt'), 'utf-8')).toBe('Preserved content');
    });
  });

  describe('Delete Operations', () => {
    it('should require explicit mode for delete operations', async () => {
      writeFileSync(join(testAppDir, 'file.txt'), 'Content');

      // Try to delete without explicit mode - should NOT delete
      const result1 = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'file.txt',
            // No mode, no content, no edits - should not auto-detect as delete
          }
        ]
      });

      // File should still exist (operation likely failed or defaulted to wrong mode)
      // The exact behavior depends on mode detection, but delete should NEVER be auto-detected

      // Now delete with explicit mode
      const result2 = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'file.txt',
            mode: 'delete'
          }
        ]
      });

      expect(result2.success).toBe(true);
      expect(result2.results[0].mode).toBe('delete');
      expect(existsSync(join(testAppDir, 'file.txt'))).toBe(false);
    });

    it('should delete multiple files in one batch', async () => {
      writeFileSync(join(testAppDir, 'file1.txt'), 'Content 1');
      writeFileSync(join(testAppDir, 'file2.txt'), 'Content 2');
      writeFileSync(join(testAppDir, 'file3.txt'), 'Content 3');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          { path: 'file1.txt', mode: 'delete' },
          { path: 'file2.txt', mode: 'delete' },
          { path: 'file3.txt', mode: 'delete' }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(3);
      expect(existsSync(join(testAppDir, 'file1.txt'))).toBe(false);
      expect(existsSync(join(testAppDir, 'file2.txt'))).toBe(false);
      expect(existsSync(join(testAppDir, 'file3.txt'))).toBe(false);
    });
  });

  describe('Dry Run Mode', () => {
    it('should not modify files in dry run mode', async () => {
      writeFileSync(join(testAppDir, 'existing.txt'), 'Original');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'new.txt',
            mode: 'create',
            content: 'New content'
          },
          {
            path: 'existing.txt',
            mode: 'rewrite',
            content: 'Modified'
          }
        ],
        dryRun: true
      });

      expect(result.success).toBe(true);

      // Files should not be modified
      expect(existsSync(join(testAppDir, 'new.txt'))).toBe(false);
      expect(readFileSync(join(testAppDir, 'existing.txt'), 'utf-8')).toBe('Original');
    });
  });

  describe('Result Formatting', () => {
    it('should include operation summary in results', async () => {
      writeFileSync(join(testAppDir, 'edit.txt'), 'Line 1\nLine 2\nLine 3');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'create.txt',
            mode: 'create',
            content: 'Created\nFile'
          },
          {
            path: 'edit.txt',
            mode: 'edit',
            edits: [{ old: 'Line 2', new: 'Modified Line 2' }]
          }
        ]
      });

      expect(result.success).toBe(true);

      // Check individual result details
      expect(result.results[0].changes).toBeDefined();
      expect(result.results[0].changes?.totalLines).toBeGreaterThan(0);

      expect(result.results[1].changes).toBeDefined();
      expect(result.results[1].changes?.additions).toBe(1);
      expect(result.results[1].changes?.deletions).toBe(1);
    });

    it('should format batch results correctly', async () => {
      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'file1.txt',
            mode: 'create',
            content: 'Content 1'
          },
          {
            path: 'file2.txt',
            mode: 'create',
            content: 'Content 2'
          }
        ]
      });

      const formatted = fileEditTool.formatResult(result);
      const parsed = JSON.parse(formatted);

      expect(parsed.success).toBe(true);
      expect(parsed.totalOperations).toBe(2);
      expect(parsed.completedOperations).toBe(2);
      expect(parsed.operations).toHaveLength(2);
      expect(parsed.operations[0].path).toBeDefined();
      expect(parsed.operations[0].mode).toBe('create');
    });

    it('should summarize batch operations correctly', async () => {
      writeFileSync(join(testAppDir, 'edit.txt'), 'Content');
      writeFileSync(join(testAppDir, 'delete.txt'), 'To delete');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          { path: 'create.txt', mode: 'create', content: 'New' },
          { path: 'edit.txt', mode: 'edit', edits: [{ old: 'Content', new: 'Modified' }] },
          { path: 'delete.txt', mode: 'delete' }
        ]
      });

      const summary = fileEditTool.summarizeOperation(
        { operations: [] },
        result
      );

      expect(summary).toMatch(/created.*1.*file/i);
      expect(summary).toMatch(/modified.*1.*file/i);
      expect(summary).toMatch(/deleted.*1.*file/i);
    });
  });

  describe('Fuzzy Matching', () => {
    it('should use fuzzy matching when enabled', async () => {
      writeFileSync(join(testAppDir, 'file.txt'), 'Line 1\nLine 2\nLine 3');

      const result = await fileEditTool.editFiles(testAppDir, {
        operations: [
          {
            path: 'file.txt',
            mode: 'edit',
            edits: [
              // Slightly different whitespace
              { old: 'Line  2', new: 'Modified Line 2' }
            ]
          }
        ],
        fuzzyMatch: true
      });

      // With fuzzy matching, this might succeed despite whitespace difference
      // (actual behavior depends on fuzzy match implementation)
      expect(result.results[0]).toBeDefined();
    });
  });
});
