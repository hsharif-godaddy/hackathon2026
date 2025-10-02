/**
 * MemoryTool Simple Integration Tests
 * 
 * Simplified tests that focus on the core functionality
 * without complex logging assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryTool } from '../memory-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';

describe('MemoryTool Simple Integration Tests', () => {
  let memoryTool: MemoryTool;
  let testDir: string;
  let testAppId: string;
  let appRepository: AppRepository;

  beforeEach(async () => {
    // Set up test directory
    testDir = join('/tmp', `memory-simple-test-${Date.now()}`);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create app repository and test app
    appRepository = new AppRepository();
    testAppId = nanoid();
    
    // Insert a test app into the database
    const createAppStmt = appRepository['db'].prepare(`
      INSERT INTO apps (id, name, path, port, initial_prompt, template_version, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    createAppStmt.run(testAppId, testAppId, testDir, 3000, 'test', 'v8', 'created');

    // Create memory tool instance
    memoryTool = new MemoryTool();
  });

  afterEach(() => {
    // Clean up test app from database
    try {
      const deleteAppStmt = appRepository['db'].prepare('DELETE FROM apps WHERE id = ?');
      deleteAppStmt.run(testAppId);
    } catch (error) {
      // Ignore cleanup errors
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Operations', () => {
    it('should set and read string values', async () => {
      const setResult = await memoryTool.setMemory({
        key: 'simple.string',
        value: 'Hello World'
      }, testDir, testAppId);

      expect(setResult.success).toBe(true);
      expect(setResult.key).toBe('simple.string');

      const readResult = await memoryTool.readMemory({
        key: 'simple.string'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('Hello World');
    });

    it('should set and read JSON objects', async () => {
      const testObject = { name: 'John', age: 30, active: true };

      const setResult = await memoryTool.setMemory({
        key: 'user.profile',
        value: testObject
      }, testDir, testAppId);

      expect(setResult.success).toBe(true);

      const readResult = await memoryTool.readMemory({
        key: 'user.profile'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toEqual(testObject);
    });

    it('should set and read arrays', async () => {
      const testArray = [1, 'two', { three: 3 }, [4, 5]];

      const setResult = await memoryTool.setMemory({
        key: 'mixed.array',
        value: testArray
      }, testDir, testAppId);

      expect(setResult.success).toBe(true);

      const readResult = await memoryTool.readMemory({
        key: 'mixed.array'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toEqual(testArray);
    });

    it('should list keys correctly', { timeout: 10000 }, async () => {
      // Set up test data
      await memoryTool.setMemory({ key: 'app.config.timeout', value: 5000 }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'app.config.retries', value: 3 }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'user.name', value: 'John' }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'user.email', value: 'john@example.com' }, testDir, testAppId);

      const listResult = await memoryTool.listKeys(testDir, undefined, testAppId);

      expect(listResult.success).toBe(true);
      expect(listResult.keys).toHaveLength(4);
      expect(listResult.keys).toContain('app.config.timeout');
      expect(listResult.keys).toContain('app.config.retries');
      expect(listResult.keys).toContain('user.name');
      expect(listResult.keys).toContain('user.email');
    });

    it('should filter keys by prefix', { timeout: 10000 }, async () => {
      // Set up test data
      await memoryTool.setMemory({ key: 'app.config.timeout', value: 5000 }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'app.config.retries', value: 3 }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'user.name', value: 'John' }, testDir, testAppId);

      const listResult = await memoryTool.listKeys(testDir, 'app.config', testAppId);

      expect(listResult.success).toBe(true);
      expect(listResult.keys).toHaveLength(2);
      expect(listResult.keys).toContain('app.config.timeout');
      expect(listResult.keys).toContain('app.config.retries');
      expect(listResult.keys).not.toContain('user.name');
    });
  });

  describe('Error Handling', () => {
    it('should reject invalid keys', async () => {
      const result = await memoryTool.setMemory({
        key: 'invalid/key*with!special@chars',
        value: 'test'
      }, testDir, testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('can only contain letters, numbers, dots, underscores, and hyphens');
    });

    it('should reject empty keys', async () => {
      const result = await memoryTool.setMemory({
        key: '',
        value: 'test'
      }, testDir, testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should handle non-existent keys gracefully', async () => {
      const result = await memoryTool.readMemory({
        key: 'does.not.exist'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(false);
      expect(result.key).toBe('does.not.exist');
    });

    it('should handle database errors gracefully', async () => {
      // Try to set memory with an invalid app ID (should fail foreign key constraint)
      const setResult = await memoryTool.setMemory({
        key: 'test.key',
        value: 'test value'
      }, testDir, 'invalid-app-id');

      expect(setResult.success).toBe(false);
      expect(setResult.error).toBeDefined();
      expect(setResult.error).toContain('FOREIGN KEY constraint failed');
    });
  });

  describe('Data Persistence', () => {
    it('should persist data across tool instances', async () => {
      // Set data with first instance
      await memoryTool.setMemory({
        key: 'persistent.data',
        value: { message: 'This should persist' }
      }, testDir, testAppId);

      // Read with new instance
      const newTool = new MemoryTool();
      const result = await newTool.readMemory({
        key: 'persistent.data'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.value).toEqual({ message: 'This should persist' });
    });

    it('should overwrite existing values', { timeout: 10000 }, async () => {
      // Set initial value
      await memoryTool.setMemory({
        key: 'overwrite.test',
        value: 'initial value'
      }, testDir, testAppId);

      // Overwrite with new value
      await memoryTool.setMemory({
        key: 'overwrite.test',
        value: 'updated value'
      }, testDir, testAppId);

      // Verify the update
      const result = await memoryTool.readMemory({
        key: 'overwrite.test'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.value).toBe('updated value');
    });
  });

  describe('Database Storage', () => {
    it('should store data in SQLite database', async () => {
      await memoryTool.setMemory({
        key: 'deep.nested.config.setting',
        value: 'nested value'
      }, testDir, testAppId);

      // Verify data is stored in database by reading it back
      const readResult = await memoryTool.readMemory({
        key: 'deep.nested.config.setting'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('nested value');
    });

    it('should classify and store data types correctly', { timeout: 15000 }, async () => {
      const testCases = [
        { key: 'type.string', value: 'text' },
        { key: 'type.object', value: { prop: 'value' } },
        { key: 'type.array', value: [1, 2, 3] },
        { key: 'type.number', value: 42 },
        { key: 'type.boolean', value: true },
        { key: 'type.null', value: null }
      ];

      for (const testCase of testCases) {
        const setResult = await memoryTool.setMemory({
          key: testCase.key,
          value: testCase.value
        }, testDir, testAppId);

        expect(setResult.success).toBe(true);

        // Read back to verify type preservation
        const readResult = await memoryTool.readMemory({
          key: testCase.key
        }, testDir, testAppId);

        expect(readResult.success).toBe(true);
        expect(readResult.exists).toBe(true);
        expect(readResult.value).toEqual(testCase.value);
      }
    });
  });

  describe('Performance', () => {
    it('should handle concurrent operations', async () => {
      const operations = [];

      // Queue multiple concurrent operations
      for (let i = 0; i < 20; i++) {
        operations.push(
          memoryTool.setMemory({
            key: `concurrent.${i}`,
            value: { id: i, data: `concurrent-${i}` }
          }, testDir, testAppId)
        );
      }

      // Execute all concurrently
      const results = await Promise.all(operations);

      // All should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.key).toBe(`concurrent.${index}`);
      });

      // Verify all data was stored correctly
      const listResult = await memoryTool.listKeys(testDir, 'concurrent', testAppId);
      expect(listResult.success).toBe(true);
      expect(listResult.keys).toHaveLength(20);
    });

    it('should complete operations quickly', async () => {
      const startTime = Date.now();

      await memoryTool.setMemory({
        key: 'performance.test',
        value: { data: 'x'.repeat(1000) }
      }, testDir, testAppId);

      await memoryTool.readMemory({
        key: 'performance.test'
      }, testDir, testAppId);

      await memoryTool.listKeys(testDir, 'performance', testAppId);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds even with Qdrant failures
    });
  });

  describe('Operations Without AppId', () => {
    it('should fail gracefully when app does not exist for path', async () => {
      // Use a different path that doesn't exist in the database
      const nonExistentPath = '/tmp/non-existent-app';
      
      const setResult = await memoryTool.setMemory({
        key: 'no.context.test',
        value: 'should fail'
      }, nonExistentPath);

      expect(setResult.success).toBe(false);
      expect(setResult.error).toContain('App not found');

      const readResult = await memoryTool.readMemory({
        key: 'no.context.test'
      }, nonExistentPath);

      expect(readResult.success).toBe(false);
      expect(readResult.error).toContain('App not found');

      const listResult = await memoryTool.listKeys(nonExistentPath);

      expect(listResult.success).toBe(false);
      expect(listResult.error).toContain('App not found');
    });
  });
});