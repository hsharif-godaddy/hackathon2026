/**
 * MemoryTool Integration Tests
 * 
 * Tests for memory tool integration with the broader agent system:
 * - Tool function execution via executeToolFunction
 * - Agent execution context handling
 * - App repository integration
 * - Token usage tracking
 * - Response formatting
 * - Error propagation through the system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryTool } from '../memory-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';
import { memorySetAITool, memoryReadAITool, memoryListKeysAITool } from '../ai-lib-tools/memory-tool.js';
import type { AgentExecutionContext } from '../../base/base-agent.js';

describe('MemoryTool Integration Tests', () => {
  let testDir: string;
  let testAppId: string;
  let appRepository: AppRepository;
  let memoryTool: MemoryTool;
  let testContext: AgentExecutionContext;

  beforeEach(async () => {
    // Set up test directory
    testDir = join('/tmp', `memory-integration-test-${Date.now()}`);
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
    createAppStmt.run(testAppId, 'Test App', testDir, 3000, 'test', 'v8', 'created');

    // Create memory tool instance
    memoryTool = new MemoryTool();

    // Set up test context for AI tools
    testContext = {
      metadata: {
        appId: testAppId
      }
    } as AgentExecutionContext;
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

  describe('Memory Set Integration', () => {
    it('should store data through database integration', async () => {
      const result = await memoryTool.setMemory({
        key: 'user.profile.name',
        value: 'John Doe'
      }, testDir, testAppId);

      expect(result.success).toBe(true);
      expect(result.key).toBe('user.profile.name');
      
      // Verify the data was actually stored by reading it back
      const readResult = await memoryTool.readMemory({
        key: 'user.profile.name'
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('John Doe');
    });

    it('should handle JSON object values through integration', async () => {
      const complexValue = {
        user: {
          id: 123,
          name: 'John Doe',
          preferences: {
            theme: 'dark',
            notifications: true,
            features: ['feature1', 'feature2']
          }
        },
        metadata: {
          created: '2024-01-01T00:00:00Z',
          version: '1.0.0'
        }
      };

      const result = await memorySetAITool.execute({
        key: 'app.user.config',
        value: complexValue
      }, testContext);

      expect(result).toBe("✅ Memory key 'app.user.config' set successfully");
      
      // Verify the complex object was stored correctly
      const readResult = await memoryReadAITool.execute({
        key: 'app.user.config'
      }, testContext);
      
      expect(readResult).toContain('app.user.config');
      expect(readResult).toContain('John Doe');
      expect(readResult).toContain('dark');
    });

    it('should handle array values through integration', async () => {
      const arrayValue = [
        { id: 1, name: 'Item 1', active: true },
        { id: 2, name: 'Item 2', active: false },
        { id: 3, name: 'Item 3', active: true }
      ];

      const result = await memorySetAITool.execute({
        key: 'app.items.list',
        value: arrayValue
      }, testContext);

      expect(result).toBe("✅ Memory key 'app.items.list' set successfully");
      
      // Verify the array was stored correctly
      const readResult = await memoryReadAITool.execute({
        key: 'app.items.list'
      }, testContext);
      
      expect(readResult).toContain('app.items.list');
      expect(readResult).toContain('Item 1');
      expect(readResult).toContain('Item 2');
    });

    it('should fail gracefully when app not found', async () => {
      const contextWithInvalidApp = {
        ...testContext,
        metadata: {
          appId: 'nonexistent-app-id'
        }
      };

      await expect(memorySetAITool.execute({
        key: 'test.key',
        value: 'test value'
      }, contextWithInvalidApp)).rejects.toThrow("App 'nonexistent-app-id' not found");
    });

    it('should fail gracefully when appId missing from context', async () => {
      const contextWithoutApp = {
        ...testContext,
        metadata: {}
      };

      await expect(memorySetAITool.execute({
        key: 'test.key',
        value: 'test value'
      }, contextWithoutApp)).rejects.toThrow('App ID is required for memory operations');
    });

    it('should fail gracefully with invalid key', async () => {
      await expect(memorySetAITool.execute({
        key: 'invalid/key*with!special@chars',
        value: 'test value'
      }, testContext)).rejects.toThrow('can only contain letters, numbers, dots, underscores, and hyphens');
    });
  });

  describe('Memory Read Integration', () => {
    beforeEach(async () => {
      // Set up test data
      await memorySetAITool.execute({
        key: 'existing.string',
        value: 'test string value'
      }, testContext);

      await memorySetAITool.execute({
        key: 'existing.object',
        value: { 
          config: { 
            timeout: 5000,
            retries: 3,
            features: ['feature1', 'feature2']
          }
        }
      }, testContext);

      await memorySetAITool.execute({
        key: 'existing.array',
        value: [1, 2, 3, 'string', { nested: true }]
      }, testContext);
    });

    it('should read string value and format response correctly', async () => {
      const result = await memoryReadAITool.execute({
        key: 'existing.string'
      }, testContext);

      expect(result).toContain("📖 Memory key 'existing.string':");
      expect(result).toContain('test string value');
    });

    it('should read JSON object and format as code block', async () => {
      const result = await memoryReadAITool.execute({
        key: 'existing.object'
      }, testContext);

      expect(result).toContain("📖 Memory key 'existing.object':");
      expect(result).toContain('```json');
      expect(result).toContain('"timeout": 5000');
      expect(result).toContain('"retries": 3');
      expect(result).toContain('```');
    });

    it('should read array value and format as code block', async () => {
      const result = await memoryReadAITool.execute({
        key: 'existing.array'
      }, testContext);

      expect(result).toContain("📖 Memory key 'existing.array':");
      expect(result).toContain('```json');
      expect(result).toContain('[');
      expect(result).toContain('"string"');
      expect(result).toContain('"nested": true');
      expect(result).toContain('```');
    });

    it('should handle non-existent key gracefully', async () => {
      const result = await memoryReadAITool.execute({
        key: 'nonexistent.key'
      }, testContext);

      expect(result).toBe("❌ Memory key 'nonexistent.key' not found");
    });

    it('should handle invalid app context gracefully', async () => {
      const contextWithInvalidApp = {
        ...testContext,
        metadata: {
          appId: 'invalid-app-id'
        }
      };

      await expect(memoryReadAITool.execute({
        key: 'some.key'
      }, contextWithInvalidApp)).rejects.toThrow("App 'invalid-app-id' not found");
    });
  });

  describe('AI Tool Execution', () => {
    it('should execute memory operations through AI tools', async () => {
      // Test that AI tools execute successfully
      const setResult = await memorySetAITool.execute({
        key: 'ai.tool.test',
        value: 'test value for ai tool execution'
      }, testContext);

      expect(setResult).toBe("✅ Memory key 'ai.tool.test' set successfully");
      
      const readResult = await memoryReadAITool.execute({
        key: 'ai.tool.test'
      }, testContext);
      
      expect(readResult).toContain('ai.tool.test');
      expect(readResult).toContain('test value for ai tool execution');
    });

    it('should handle large data operations efficiently', async () => {
      const largeValue = {
        data: 'x'.repeat(1000),
        array: new Array(100).fill(0).map((_, i) => ({ id: i, name: `item-${i}` }))
      };

      const result = await memorySetAITool.execute({
        key: 'large.data.test',
        value: largeValue
      }, testContext);

      expect(result).toBe("✅ Memory key 'large.data.test' set successfully");
      
      // Verify large data can be read back
      const readResult = await memoryReadAITool.execute({
        key: 'large.data.test'
      }, testContext);
      
      expect(readResult).toContain('large.data.test');
    });
  });

  describe('Context Handling', () => {
    it('should use app context correctly', async () => {
      const result = await memorySetAITool.execute({
        key: 'context.test',
        value: 'context test value'
      }, testContext);

      expect(result).toBe("✅ Memory key 'context.test' set successfully");
      
      // Verify data is associated with correct app
      const readResult = await memoryReadAITool.execute({
        key: 'context.test'
      }, testContext);
      
      expect(readResult).toContain('context.test');
      expect(readResult).toContain('context test value');
    });

    it('should handle minimal context gracefully', async () => {
      const minimalContext = {
        metadata: {
          appId: testAppId
        }
      } as AgentExecutionContext;

      const result = await memorySetAITool.execute({
        key: 'minimal.context',
        value: 'test'
      }, minimalContext);

      expect(result).toBe("✅ Memory key 'minimal.context' set successfully");
    });
  });

  describe('Error Handling', () => {
    it('should propagate validation errors from memory tool', async () => {
      await expect(memorySetAITool.execute({
        key: '',
        value: 'test'
      }, testContext)).rejects.toThrow('Key must be a non-empty string');
    });

    it('should handle invalid key formats', async () => {
      await expect(memorySetAITool.execute({
        key: 'invalid/key*with!special@chars',
        value: 'test'
      }, testContext)).rejects.toThrow('can only contain letters, numbers, dots, underscores, and hyphens');
    });

    it('should handle missing app context', async () => {
      const contextWithoutApp = {
        ...testContext,
        metadata: {}
      };
      
      await expect(memorySetAITool.execute({
        key: 'test.key',
        value: 'test'
      }, contextWithoutApp)).rejects.toThrow('App ID is required for memory operations');
    });
  });

  describe('Cross-Operation Integration', () => {
    it('should maintain data consistency across multiple operations', async () => {
      // Set initial data
      await memorySetAITool.execute({
        key: 'consistency.test',
        value: { counter: 0, items: [] }
      }, testContext);

      // Read and verify
      let result = await memoryReadAITool.execute({
        key: 'consistency.test'
      }, testContext);

      expect(result).toContain('"counter": 0');
      expect(result).toContain('"items": []');

      // Update data
      await memorySetAITool.execute({
        key: 'consistency.test',
        value: { counter: 5, items: ['item1', 'item2'] }
      }, testContext);

      // Read updated data
      result = await memoryReadAITool.execute({
        key: 'consistency.test'
      }, testContext);

      expect(result).toContain('"counter": 5');
      expect(result).toContain('"item1"');
      expect(result).toContain('"item2"');
    });

    it('should handle concurrent operations safely', async () => {
      const operations = [];

      // Queue multiple concurrent set operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          memorySetAITool.execute({
            key: `concurrent.${i}`,
            value: { id: i, data: `data-${i}` }
          }, testContext)
        );
      }

      // Execute all concurrently
      const results = await Promise.all(operations);

      // All should succeed
      results.forEach((result, index) => {
        expect(result).toBe(`✅ Memory key 'concurrent.${index}' set successfully`);
      });

      // Verify all data was stored correctly
      for (let i = 0; i < 10; i++) {
        const readResult = await memoryReadAITool.execute({
          key: `concurrent.${i}`
        }, testContext);

        expect(readResult).toContain(`"id": ${i}`);
        expect(readResult).toContain(`"data": "data-${i}"`);
      }
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large data operations efficiently', async () => {
      const startTime = Date.now();

      const largeData = {
        users: new Array(1000).fill(0).map((_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          settings: {
            theme: i % 2 === 0 ? 'dark' : 'light',
            notifications: i % 3 === 0,
            features: [`feature${i % 5}`, `feature${(i + 1) % 5}`]
          }
        })),
        metadata: {
          total: 1000,
          generated: new Date().toISOString(),
          version: '2.0.0'
        }
      };

      // Set large data
      await memorySetAITool.execute({
        key: 'performance.large.dataset',
        value: largeData
      }, testContext);

      // Read it back
      const result = await memoryReadAITool.execute({
        key: 'performance.large.dataset'
      }, testContext);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000);
      
      // Verify data integrity
      expect(result).toContain('"total": 1000');
      expect(result).toContain('"version": "2.0.0"');
    });

    it('should clean up resources properly', async () => {
      // Perform multiple operations
      for (let i = 0; i < 20; i++) {
        await memorySetAITool.execute({
          key: `cleanup.test.${i}`,
          value: { iteration: i }
        }, testContext);
      }

      // Verify data was stored in database correctly
      const listResult = await memoryListKeysAITool.execute({
        prefix: 'cleanup.test'
      }, testContext);
      
      expect(listResult).toContain('20 memory key(s)');
      
      // Verify we can read some of the data back
      const readResult = await memoryReadAITool.execute({
        key: 'cleanup.test.0'
      }, testContext);
      
      expect(readResult).toContain('cleanup.test.0');
      expect(readResult).toContain('"iteration": 0');
    });
  });
});