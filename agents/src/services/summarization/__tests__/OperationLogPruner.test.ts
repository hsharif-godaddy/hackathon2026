import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperationLogPruner } from '../OperationLogPruner.js';
import type { OperationLogEntry } from '../OperationLogExtractor.js';
import { logger } from '../../../logging/index.js';

describe('OperationLogPruner', function operationLogPrunerTests() {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('prune', function pruneTests() {
    it('should not prune when below limit', function belowLimit() {
      const entries: OperationLogEntry[] = [
        { tool: 'str_replace_based_edit_tool', files: ['file1.ts'], mode: 'edit', description: 'edit: file1.ts' },
        { tool: 'terminalCommand', description: 'npm install' },
        { tool: 'readFile', files: ['file2.ts'], description: 'Read file2.ts' },
      ];

      const result = OperationLogPruner.prune(entries, 500);

      expect(result).toHaveLength(3);
      expect(result).toEqual(entries);
    });

    it('should prune operations exceeding limit', function exceedsLimit() {
      // Create 600 operations (400 file ops + 200 other ops)
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 400; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      for (let i = 0; i < 200; i++) {
        entries.push({
          tool: 'terminalCommand',
          description: `command ${i}`,
        });
      }

      const result = OperationLogPruner.prune(entries, 500);

      expect(result).toHaveLength(500);
    });

    it('should prioritize file operations (75/25 split)', function prioritizeFileOps() {
      // Create 1000 operations (800 file ops + 200 other ops)
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 800; i++) {
        entries.push({
          tool: i % 2 === 0 ? 'str_replace_based_edit_tool' : 'readFile',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      for (let i = 0; i < 200; i++) {
        entries.push({
          tool: 'terminalCommand',
          description: `command ${i}`,
        });
      }

      const result = OperationLogPruner.prune(entries, 500);

      expect(result).toHaveLength(500);

      // Count file operations vs other operations
      const fileOps = result.filter(e => e.tool === 'str_replace_based_edit_tool' || e.tool === 'readFile');
      const otherOps = result.filter(e => e.tool !== 'str_replace_based_edit_tool' && e.tool !== 'readFile');

      // Should be approximately 75% file ops, 25% other ops
      expect(fileOps.length).toBe(375); // 500 * 0.75
      expect(otherOps.length).toBe(125); // 500 * 0.25
    });

    it('should keep most recent operations', function keepRecent() {
      // Create 600 mixed operations with identifiable order (500 file + 100 terminal)
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 500; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      for (let i = 0; i < 100; i++) {
        entries.push({
          tool: 'terminalCommand',
          description: `command ${i}`,
        });
      }

      const result = OperationLogPruner.prune(entries, 500);

      // With 500 file ops and 100 terminal ops:
      // File quota: 375, Other quota: 125
      // Only 100 other ops available (25 deficit), redistribute to file ops
      // Result: 400 file ops (375 + 25 redistributed) + 100 other ops = 500 total
      expect(result).toHaveLength(500);

      // Should keep most recent file operations (last 400 of 500)
      const fileOps = result.filter(e => e.tool === 'str_replace_based_edit_tool' || e.tool === 'readFile');
      expect(fileOps).toHaveLength(400);

      // Should keep all terminal operations (only 100 available)
      const terminalOps = result.filter(e => e.tool === 'terminalCommand');
      expect(terminalOps).toHaveLength(100);
    });

    it('should handle case with only file operations', function onlyFileOps() {
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 600; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      const result = OperationLogPruner.prune(entries, 500);

      // With only file ops: file quota is 375 (75%), other quota is 125 (25%)
      // Since there are no other ops, the unused 125 quota is redistributed to file ops
      // Result: 500 file ops (full maxOperations limit)
      expect(result).toHaveLength(500);

      // All should be file operations
      const fileOps = result.filter(e => e.tool === 'str_replace_based_edit_tool' || e.tool === 'readFile');
      expect(fileOps).toHaveLength(500);
    });

    it('should handle case with only other operations', function onlyOtherOps() {
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 600; i++) {
        entries.push({
          tool: 'terminalCommand',
          description: `command ${i}`,
        });
      }

      const result = OperationLogPruner.prune(entries, 500);

      // With only other ops: file quota is 375 (75%), other quota is 125 (25%)
      // Since there are no file ops, the unused 375 quota is redistributed to other ops
      // Result: 500 other ops (full maxOperations limit)
      expect(result).toHaveLength(500);

      // All should be other operations
      const otherOps = result.filter(e => e.tool !== 'str_replace_based_edit_tool' && e.tool !== 'readFile');
      expect(otherOps).toHaveLength(500);
    });

    it('should log pruning statistics', function loggingStats() {
      const loggerInfoSpy = vi.spyOn(logger, 'info');

      const entries: OperationLogEntry[] = [];
      for (let i = 0; i < 600; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      OperationLogPruner.prune(entries, 500);

      expect(loggerInfoSpy).toHaveBeenCalledWith('operation_log.pruning.begin', {
        totalOperations: 600,
        maxOperations: 500,
        excessOperations: 100,
      });

      // With only file ops: 500 kept (full quota with redistribution)
      expect(loggerInfoSpy).toHaveBeenCalledWith('operation_log.pruning.complete', {
        originalCount: 600,
        prunedCount: 500,
        fileOperations: 500,
        otherOperations: 0,
        prunedFileOps: 100, // 600 - 500
        prunedOtherOps: 0,
      });
    });

    it('should use default max operations when not specified', function defaultMax() {
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 600; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      const result = OperationLogPruner.prune(entries);

      // DEFAULT_MAX_OPERATIONS is 500, with only file ops: 500 kept (full quota with redistribution)
      expect(result).toHaveLength(500);
    });
  });

  describe('needsPruning', function needsPruningTests() {
    it('should return false when below limit', function belowLimit() {
      const entries: OperationLogEntry[] = [
        { tool: 'str_replace_based_edit_tool', files: ['file1.ts'], mode: 'edit', description: 'edit: file1.ts' },
      ];

      expect(OperationLogPruner.needsPruning(entries, 500)).toBe(false);
    });

    it('should return true when exceeds limit', function exceedsLimit() {
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 501; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      expect(OperationLogPruner.needsPruning(entries, 500)).toBe(true);
    });

    it('should return false when exactly at limit', function atLimit() {
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 500; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      expect(OperationLogPruner.needsPruning(entries, 500)).toBe(false);
    });

    it('should use default max operations when not specified', function defaultMax() {
      const entries: OperationLogEntry[] = [];

      for (let i = 0; i < 501; i++) {
        entries.push({
          tool: 'str_replace_based_edit_tool',
          files: [`file${i}.ts`],
          mode: 'edit',
          description: `edit: file${i}.ts`,
        });
      }

      expect(OperationLogPruner.needsPruning(entries)).toBe(true);
    });
  });
});
