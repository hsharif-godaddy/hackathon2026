/**
 * MemoryTool Unit Tests
 * 
 * Comprehensive tests for the hierarchical memory storage tool including:
 * - Basic CRUD operations (set, read, list)
 * - Hierarchical key management
 * - Value type handling (strings, objects, arrays)
 * - Error conditions and edge cases
 * - Structured logging integration
 * - File system operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryTool } from '../memory-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { Logger } from '../../logging/index.js';
import { TestHandler } from '../../logging/handlers/TestHandler.js';
import { LoggingPresets } from '../../logging/config.js';
import { nanoid } from 'nanoid';

describe('MemoryTool Unit Tests', () => {
  let memoryTool: MemoryTool;
  let testDir: string;
  let testAppId: string;
  let appRepository: AppRepository;
  let testHandler: TestHandler;

  beforeEach(async () => {
    // Set up test directory
    testDir = join('/tmp', `memory-tool-test-${Date.now()}`);
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

    // Set up logging test handler
    testHandler = new TestHandler();
    Logger.configure({
      ...LoggingPresets.test(),
      handlers: [testHandler]
    });

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

  describe('Initialization', () => {
    it('should create memory tool instance successfully', () => {
      expect(memoryTool).toBeDefined();
      expect(memoryTool).toBeInstanceOf(MemoryTool);
    });

    it('should store data in database successfully', async () => {
      const result = await memoryTool.setMemory({
        key: 'test.key',
        value: 'test value'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      
      const readResult = await memoryTool.readMemory({
        key: 'test.key'
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('test value');
    });
  });

  describe('Set Operations', () => {
    it('should set string value successfully', async () => {
      const result = await memoryTool.setMemory({
        key: 'user.name',
        value: 'John Doe'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('user.name');
    });

    it('should set JSON object successfully', async () => {
      const testObject = {
        host: 'localhost',
        port: 3306,
        database: 'testdb'
      };

      const result = await memoryTool.setMemory({
        key: 'app.config.database',
        value: testObject
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('app.config.database');
    });

    it('should set array value successfully', async () => {
      const testArray = ['dark', 'light', 'auto'];

      const result = await memoryTool.setMemory({
        key: 'user.preferences.themes',
        value: testArray
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('user.preferences.themes');
    });

    it('should handle null values', async () => {
      const result = await memoryTool.setMemory({
        key: 'config.nullable',
        value: null
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('config.nullable');
    });

    it('should handle boolean values', async () => {
      const result = await memoryTool.setMemory({
        key: 'features.enabled',
        value: true
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('features.enabled');
    });

    it('should handle number values', async () => {
      const result = await memoryTool.setMemory({
        key: 'config.timeout',
        value: 5000
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('config.timeout');
    });
  });

  describe('Read Operations', () => {
    it('should read string value successfully', async () => {
      // Set up data first
      await memoryTool.setMemory({
        key: 'user.name',
        value: 'John Doe'
      }, testDir, testAppId);

      // Read it back
      const result = await memoryTool.readMemory({
        key: 'user.name'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.key).toBe('user.name');
      expect(result.value).toBe('John Doe');
    });

    it('should read JSON object successfully', async () => {
      const testObject = {
        host: 'localhost',
        port: 3306,
        database: 'testdb'
      };

      // Set up data first
      await memoryTool.setMemory({
        key: 'app.config.database',
        value: testObject
      }, testDir, testAppId);

      // Read it back
      const result = await memoryTool.readMemory({
        key: 'app.config.database'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.key).toBe('app.config.database');
      expect(result.value).toEqual(testObject);
    });

    it('should read array value successfully', async () => {
      const testArray = ['dark', 'light', 'auto'];

      // Set up data first
      await memoryTool.setMemory({
        key: 'user.preferences.themes',
        value: testArray
      }, testDir, testAppId);

      // Read it back
      const result = await memoryTool.readMemory({
        key: 'user.preferences.themes'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.key).toBe('user.preferences.themes');
      expect(result.value).toEqual(testArray);
    });

    it('should handle non-existent key', async () => {
      const result = await memoryTool.readMemory({
        key: 'nonexistent.key'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(false);
      expect(result.key).toBe('nonexistent.key');
      expect(result.value).toBeUndefined();
    });

    it('should handle reading from app with no memory data', async () => {
      // Create a new app with no memory data
      const newAppId = nanoid();
      const emptyDir = join('/tmp', `empty-test-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });
      
      const createNewAppStmt = appRepository['db'].prepare(`
        INSERT INTO apps (id, name, path, port, initial_prompt, template_version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      createNewAppStmt.run(newAppId, newAppId, emptyDir, 3000, 'test', 'v8', 'created');

      try {
        const result = await memoryTool.readMemory({
          key: 'some.key'
        }, emptyDir, newAppId);

        expect(result.success).toBe(true);
        expect(result.exists).toBe(false);
      } finally {
        // Clean up new app
        const deleteNewAppStmt = appRepository['db'].prepare('DELETE FROM apps WHERE id = ?');
        deleteNewAppStmt.run(newAppId);
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('List Operations', () => {
    beforeEach(async () => {
      // Set up test data
      await memoryTool.setMemory({ key: 'user.name', value: 'John Doe' }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'user.email', value: 'john@example.com' }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'app.config.timeout', value: 5000 }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'app.config.retries', value: 3 }, testDir, testAppId);
      await memoryTool.setMemory({ key: 'features.darkMode', value: true }, testDir, testAppId);
    });

    it('should list all keys', async () => {
      const result = await memoryTool.listKeys(testDir, undefined, testAppId);

      expect(result.success).toBe(true);
      expect(result.keys).toHaveLength(5);
      expect(result.keys).toContain('user.name');
      expect(result.keys).toContain('user.email');
      expect(result.keys).toContain('app.config.timeout');
      expect(result.keys).toContain('app.config.retries');
      expect(result.keys).toContain('features.darkMode');
    });

    it('should list keys with prefix filter', async () => {
      const result = await memoryTool.listKeys(testDir, 'user', testAppId);

      expect(result.success).toBe(true);
      expect(result.keys).toHaveLength(2);
      expect(result.keys).toContain('user.name');
      expect(result.keys).toContain('user.email');
      expect(result.keys).not.toContain('app.config.timeout');
    });

    it('should list keys with nested prefix filter', async () => {
      const result = await memoryTool.listKeys(testDir, 'app.config', testAppId);

      expect(result.success).toBe(true);
      expect(result.keys).toHaveLength(2);
      expect(result.keys).toContain('app.config.timeout');
      expect(result.keys).toContain('app.config.retries');
      expect(result.keys).not.toContain('user.name');
    });

    it('should handle prefix with no matches', async () => {
      const result = await memoryTool.listKeys(testDir, 'nonexistent', testAppId);

      expect(result.success).toBe(true);
      expect(result.keys).toHaveLength(0);
    });

    it('should handle empty memory directory', async () => {
      const emptyDir = join('/tmp', `empty-test-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });

      try {
        const result = await memoryTool.listKeys(emptyDir, undefined, 'test-app-123');

        expect(result.success).toBe(true);
        expect(result.keys).toHaveLength(0);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('Hierarchical Key Structure', () => {
    it('should store and retrieve nested keys', async () => {
      const result = await memoryTool.setMemory({
        key: 'deep.nested.config.setting',
        value: 'test'
      }, testDir, testAppId);
      
      expect(result.success).toBe(true);
      
      const readResult = await memoryTool.readMemory({
        key: 'deep.nested.config.setting'
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('test');
    });

    it('should handle keys with single level', async () => {
      const result = await memoryTool.setMemory({
        key: 'simplesetting',
        value: 'simple'
      }, testDir, testAppId);
      
      expect(result.success).toBe(true);
      
      const readResult = await memoryTool.readMemory({
        key: 'simplesetting'
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('simple');
    });

    it('should handle keys with many levels', async () => {
      const result = await memoryTool.setMemory({
        key: 'level1.level2.level3.level4.level5.setting',
        value: 'deep'
      }, testDir, testAppId);
      
      expect(result.success).toBe(true);
      
      const readResult = await memoryTool.readMemory({
        key: 'level1.level2.level3.level4.level5.setting'
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('deep');
    });
  });

  describe('Error Handling and Validation', () => {
    it('should reject empty key', async () => {
      const result = await memoryTool.setMemory({
        key: '',
        value: 'test'
      }, testDir, testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should reject null/undefined key', async () => {
      const result = await memoryTool.setMemory({
        key: null as any,
        value: 'test'
      }, testDir, testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should reject keys with invalid characters', async () => {
      const result = await memoryTool.setMemory({
        key: 'invalid/key*with!special@chars',
        value: 'test'
      }, testDir, testAppId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('can only contain letters, numbers, dots, underscores, and hyphens');
    });

    it('should accept keys with valid characters', async () => {
      const validKeys = [
        'simple',
        'with.dots',
        'with_underscores',
        'with-hyphens',
        'mixed123.test_key-value',
        'UPPERCASE.lowercase.123'
      ];

      for (const key of validKeys) {
        const result = await memoryTool.setMemory({
          key,
          value: 'test'
        }, testDir, testAppId);

        expect(result.success).toBe(true);
      }
    });

    it('should handle invalid app IDs gracefully', async () => {
      // Try to read memory with an invalid app ID (returns success but no data found)
      const result = await memoryTool.readMemory({
        key: 'nonexistent.key'
      }, testDir, 'invalid-app-id');

      expect(result.success).toBe(true);
      expect(result.exists).toBe(false);
      expect(result.value).toBeUndefined();
    });
  });

  describe('Data Persistence and File Operations', () => {
    it('should persist data across tool instances', async () => {
      // Set data with first instance
      await memoryTool.setMemory({
        key: 'persistent.data',
        value: 'should persist'
      }, testDir, testAppId);

      // Read with new instance
      const newTool = new MemoryTool();
      const result = await newTool.readMemory({
        key: 'persistent.data'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.value).toBe('should persist');
    });

    it('should overwrite existing values', async () => {
      // Set initial value
      await memoryTool.setMemory({
        key: 'mutable.setting',
        value: 'initial'
      }, testDir, testAppId);

      // Overwrite with new value
      await memoryTool.setMemory({
        key: 'mutable.setting',
        value: 'updated'
      }, testDir, testAppId);

      // Verify the update
      const result = await memoryTool.readMemory({
        key: 'mutable.setting'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.value).toBe('updated');
    });

    it('should store and retrieve complex objects', async () => {
      const testObject = { data: 'test', nested: { value: 42 } };
      
      const result = await memoryTool.setMemory({
        key: 'metadata.test',
        value: testObject
      }, testDir, testAppId);

      expect(result.success).toBe(true);

      const readResult = await memoryTool.readMemory({
        key: 'metadata.test'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toEqual(testObject);
    });

    it('should handle different value types correctly', async () => {
      const testCases = [
        { key: 'type.string', value: 'string' },
        { key: 'type.object', value: { object: true } },
        { key: 'type.array', value: [1, 2, 3] },
        { key: 'type.number', value: 123 },
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

  describe('Performance and Concurrent Operations', () => {
    it('should handle multiple concurrent writes', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          memoryTool.setMemory({
            key: `concurrent.write.${i}`,
            value: `value-${i}`
          }, testDir, testAppId)
        );
      }

      const results = await Promise.all(promises);

      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.key).toBe(`concurrent.write.${index}`);
      });

      // Verify all values were written correctly
      const listResult = await memoryTool.listKeys(testDir, 'concurrent.write', testAppId);
      expect(listResult.keys).toHaveLength(10);
    });

    it('should handle multiple concurrent reads', async () => {
      // Set up test data
      await memoryTool.setMemory({ key: 'concurrent.read.test', value: 'shared' }, testDir, testAppId);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          memoryTool.readMemory({
            key: 'concurrent.read.test'
          }, testDir, testAppId)
        );
      }

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.exists).toBe(true);
        expect(result.value).toBe('shared');
      });
    });

    it('should complete operations in reasonable time', async () => {
      const startTime = Date.now();

      await memoryTool.setMemory({
        key: 'performance.test',
        value: { large: 'data'.repeat(1000) }
      }, testDir, testAppId);

      await memoryTool.readMemory({
        key: 'performance.test'
      }, testDir, testAppId);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100); // Should complete quickly
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should fail operations without valid appId context', async () => {
      // Use a completely different path that definitely won't exist in database
      const nonExistentPath = '/tmp/definitely-does-not-exist-in-db';
      
      const setResult = await memoryTool.setMemory({
        key: 'no.context',
        value: 'test'
      }, nonExistentPath);

      expect(setResult.success).toBe(false);
      expect(setResult.error).toContain('App not found for the given path');

      const readResult = await memoryTool.readMemory({
        key: 'no.context'
      }, nonExistentPath);

      expect(readResult.success).toBe(false);
      expect(readResult.error).toContain('App not found for the given path');
    });

    it('should handle very long keys', async () => {
      const longKey = 'very.long.key.with.many.segments.that.creates.deep.directory.structure.for.testing.purposes.and.validation';
      
      const result = await memoryTool.setMemory({
        key: longKey,
        value: 'deep value'
      }, testDir, testAppId);

      expect(result.success).toBe(true);

      const readResult = await memoryTool.readMemory({
        key: longKey
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.value).toBe('deep value');
    });

    it('should handle large data values', async () => {
      const largeObject = {
        data: 'x'.repeat(10000),
        array: new Array(1000).fill(0).map((_, i) => ({ id: i, value: `item-${i}` })),
        nested: {
          deep: {
            structure: {
              with: 'various types',
              numbers: [1, 2, 3, 4, 5],
              booleans: [true, false, true]
            }
          }
        }
      };

      const result = await memoryTool.setMemory({
        key: 'large.data.test',
        value: largeObject
      }, testDir, testAppId);

      expect(result.success).toBe(true);

      const readResult = await memoryTool.readMemory({
        key: 'large.data.test'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.value).toEqual(largeObject);
    });

    it('should handle special characters in values', async () => {
      const specialValue = {
        unicode: '🚀 测试 αβγ',
        quotes: 'He said "Hello" and she replied \'Hi\'',
        newlines: 'Line 1\nLine 2\r\nLine 3',
        special: '!@#$%^&*()[]{}|\\:";\'<>?,./'
      };

      const result = await memoryTool.setMemory({
        key: 'special.chars',
        value: specialValue
      }, testDir, testAppId);

      expect(result.success).toBe(true);

      const readResult = await memoryTool.readMemory({
        key: 'special.chars'
      }, testDir, testAppId);

      expect(readResult.success).toBe(true);
      expect(readResult.value).toEqual(specialValue);
    });
  });
});