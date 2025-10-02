/**
 * MemoryTool Logging Integration Tests
 * 
 * Tests specifically focused on validating the structured logging integration:
 * - Event generation and formatting
 * - Context propagation (appId, operation metadata)
 * - Performance metrics capture
 * - Error logging scenarios
 * - Log event validation against schema
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryTool } from '../memory-tool.js';
import { Logger } from '../../logging/index.js';
import { TestHandler } from '../../logging/handlers/TestHandler.js';
import { LoggingPresets } from '../../logging/config.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';

describe('MemoryTool Logging Integration Tests', () => {
  let memoryTool: MemoryTool;
  let testDir: string;
  let testHandler: TestHandler;
  let testAppId: string;
  let appRepository: AppRepository;

  beforeEach(() => {
    // Set up test directory
    testDir = join('/tmp', `memory-logging-test-${Date.now()}`);
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
    createAppStmt.run(testAppId, 'Logging Test App', testDir, 3000, 'test', 'v8', 'created');

    // Set up logging test handler
    testHandler = new TestHandler();
    Logger.configure({
      level: 'debug',
      handlers: [testHandler],
      enabledDomains: ['tool']
    });

    // Create memory tool instance (this will create a new logger after configuration)
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
    
    // Clear test events
    testHandler.clear();
  });

  describe('Set Operation Logging', () => {
    it('should log begin and success events for successful set operation', async () => {
      await memoryTool.setMemory({
        key: 'user.name',
        value: 'John Doe'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      // Should have begin and success events
      expect(events).toHaveLength(2);
      
      // Check begin event
      const beginEvent = events[0];
      expect(beginEvent.event).toBe('tool.memory.set.begin');
      expect(beginEvent.level).toBe('info');
      expect(beginEvent.toolName).toBe('memory');
      expect(beginEvent.appId).toBe(testAppId);
      expect(beginEvent.key).toBe('user.name');
      expect(beginEvent.operation).toBe('set');
      expect(beginEvent.valueType).toBe('string');

      // Check success event
      const successEvent = events[1];
      expect(successEvent.event).toBe('tool.memory.set.success');
      expect(successEvent.level).toBe('info');
      expect(successEvent.toolName).toBe('memory');
      expect(successEvent.appId).toBe(testAppId);
      expect(successEvent.key).toBe('user.name');
      expect(successEvent.operation).toBe('set');
      expect(successEvent.valueType).toBe('string');
      expect(successEvent.memoryPath).toContain('.airo-memory');
      expect(successEvent.resultStats).toBeDefined();
      expect(successEvent.resultStats.success).toBe(true);
      expect(successEvent.resultStats.executionTime).toBeTypeOf('number');
      expect(successEvent.resultStats.executionTime).toBeGreaterThan(0);
    });

    it('should log proper value types for different data types', async () => {
      const testCases = [
        { key: 'string.test', value: 'text', expectedType: 'string' },
        { key: 'number.test', value: 42, expectedType: 'number' },
        { key: 'boolean.test', value: true, expectedType: 'boolean' },
        { key: 'object.test', value: { prop: 'value' }, expectedType: 'object' },
        { key: 'array.test', value: [1, 2, 3], expectedType: 'array' },
        { key: 'null.test', value: null, expectedType: 'null' }
      ];

      for (const testCase of testCases) {
        testHandler.clear();
        
        await memoryTool.setMemory({
          key: testCase.key,
          value: testCase.value
        }, testDir, testAppId);

        const events = testHandler.getEvents();
        const beginEvent = events[0];
        const successEvent = events[1];

        expect(beginEvent.valueType).toBe(testCase.expectedType);
        expect(successEvent.valueType).toBe(testCase.expectedType);
      }
    });

    it('should log without appId when not provided', async () => {
      await memoryTool.setMemory({
        key: 'no.context',
        value: 'test'
      }, testDir);

      const events = testHandler.getEvents();
      
      expect(events).toHaveLength(2);
      
      const beginEvent = events[0];
      expect(beginEvent.appId).toBeUndefined();
      
      const successEvent = events[1];
      expect(successEvent.appId).toBeUndefined();
    });

    it('should log failure event on invalid key', async () => {
      await memoryTool.setMemory({
        key: 'invalid/key',
        value: 'test'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      expect(events).toHaveLength(2);
      
      // Should have begin and failure events
      expect(events[0].event).toBe('tool.memory.set.begin');
      expect(events[1].event).toBe('tool.memory.set.failure');
      expect(events[1].level).toBe('error');
      expect(events[1].error).toBeDefined();
      expect(events[1].error.message).toContain('can only contain letters, numbers, dots, underscores, and hyphens');
    });
  });

  describe('Read Operation Logging', () => {
    beforeEach(async () => {
      // Set up test data
      await memoryTool.setMemory({
        key: 'existing.key',
        value: { data: 'test' }
      }, testDir, testAppId);
      
      // Clear events from setup
      testHandler.clear();
    });

    it('should log begin and success events for existing key', async () => {
      await memoryTool.readMemory({
        key: 'existing.key'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      expect(events).toHaveLength(2);
      
      // Check begin event
      const beginEvent = events[0];
      expect(beginEvent.event).toBe('tool.memory.read.begin');
      expect(beginEvent.level).toBe('info');
      expect(beginEvent.toolName).toBe('memory');
      expect(beginEvent.appId).toBe(testAppId);
      expect(beginEvent.key).toBe('existing.key');
      expect(beginEvent.operation).toBe('read');

      // Check success event
      const successEvent = events[1];
      expect(successEvent.event).toBe('tool.memory.read.success');
      expect(successEvent.level).toBe('info');
      expect(successEvent.keyExists).toBe(true);
      expect(successEvent.valueType).toBe('object');
      expect(successEvent.resultStats.success).toBe(true);
      expect(successEvent.resultStats.executionTime).toBeTypeOf('number');
    });

    it('should log success event for non-existent key', async () => {
      await memoryTool.readMemory({
        key: 'nonexistent.key'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      expect(events).toHaveLength(2);
      
      const successEvent = events[1];
      expect(successEvent.event).toBe('tool.memory.read.success');
      expect(successEvent.keyExists).toBe(false);
      expect(successEvent.valueType).toBeUndefined();
      expect(successEvent.resultStats.success).toBe(true);
    });

    it('should log failure event on read error', async () => {
      // Create a corrupted file to trigger read error
      const memoryDir = join(testDir, '.airo-memory');
      mkdirSync(memoryDir, { recursive: true });
      const fs = await import('fs/promises');
      await fs.writeFile(join(memoryDir, 'corrupted.json'), 'invalid json{', 'utf-8');

      await memoryTool.readMemory({
        key: 'corrupted'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      expect(events).toHaveLength(2);
      expect(events[1].event).toBe('tool.memory.read.failure');
      expect(events[1].level).toBe('error');
      expect(events[1].error).toBeDefined();
    });
  });

  describe('List Operation Logging', () => {
    beforeEach(async () => {
      // Set up test data
      await memoryTool.setMemory({ key: 'user.name', value: 'John' }, testDir, 'test-app-123');
      await memoryTool.setMemory({ key: 'user.email', value: 'john@test.com' }, testDir, 'test-app-123');
      await memoryTool.setMemory({ key: 'app.config', value: { timeout: 5000 } }, testDir, 'test-app-123');
      
      // Clear events from setup
      testHandler.clear();
    });

    it('should log begin and success events for list all keys', async () => {
      await memoryTool.listKeys(testDir, undefined, 'test-app-123');

      const events = testHandler.getEvents();
      
      expect(events).toHaveLength(2);
      
      // Check begin event
      const beginEvent = events[0];
      expect(beginEvent.event).toBe('tool.memory.list.begin');
      expect(beginEvent.level).toBe('info');
      expect(beginEvent.toolName).toBe('memory');
      expect(beginEvent.appId).toBe(testAppId);
      expect(beginEvent.operation).toBe('list');
      expect(beginEvent.prefix).toBeUndefined();

      // Check success event
      const successEvent = events[1];
      expect(successEvent.event).toBe('tool.memory.list.success');
      expect(successEvent.level).toBe('info');
      expect(successEvent.operation).toBe('list');
      expect(successEvent.resultStats.keyCount).toBe(3);
      expect(successEvent.resultStats.success).toBe(true);
      expect(successEvent.resultStats.executionTime).toBeTypeOf('number');
    });

    it('should log prefix filter in events', async () => {
      await memoryTool.listKeys(testDir, 'user', 'test-app-123');

      const events = testHandler.getEvents();
      
      const beginEvent = events[0];
      expect(beginEvent.prefix).toBe('user');
      
      const successEvent = events[1];
      expect(successEvent.resultStats.keyCount).toBe(2); // Only user.name and user.email
    });

    it('should log success for empty directory', async () => {
      const emptyDir = join('/tmp', `empty-logging-test-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });

      try {
        await memoryTool.listKeys(emptyDir, undefined, 'test-app-123');

        const events = testHandler.getEvents();
        
        expect(events).toHaveLength(2);
        const successEvent = events[1];
        expect(successEvent.event).toBe('tool.memory.list.success');
        expect(successEvent.resultStats.keyCount).toBe(0);
        expect(successEvent.resultStats.success).toBe(true);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('Performance Metrics Logging', () => {
    it('should capture execution time for all operations', async () => {
      // Set operation
      await memoryTool.setMemory({
        key: 'perf.test',
        value: 'performance test'
      }, testDir, testAppId);

      const setEvents = testHandler.getEvents();
      testHandler.clear();

      // Read operation
      await memoryTool.readMemory({
        key: 'perf.test'
      }, testDir, testAppId);

      const readEvents = testHandler.getEvents();
      testHandler.clear();

      // List operation
      await memoryTool.listKeys(testDir, undefined, 'test-app-123');

      const listEvents = testHandler.getEvents();

      // Check that all success events have execution time
      expect(setEvents[1].resultStats.executionTime).toBeTypeOf('number');
      expect(setEvents[1].resultStats.executionTime).toBeGreaterThan(0);
      
      expect(readEvents[1].resultStats.executionTime).toBeTypeOf('number');
      expect(readEvents[1].resultStats.executionTime).toBeGreaterThan(0);
      
      expect(listEvents[1].resultStats.executionTime).toBeTypeOf('number');
      expect(listEvents[1].resultStats.executionTime).toBeGreaterThan(0);
    });

    it('should track key count in list operations', async () => {
      // Set up varying amounts of data
      for (let i = 0; i < 5; i++) {
        await memoryTool.setMemory({
          key: `batch.${i}`,
          value: `value-${i}`
        }, testDir, testAppId);
      }

      testHandler.clear();

      // List all keys
      await memoryTool.listKeys(testDir, undefined, 'test-app-123');
      const allEvents = testHandler.getEvents();
      expect(allEvents[1].resultStats.keyCount).toBe(5);

      testHandler.clear();

      // List with filter
      await memoryTool.listKeys(testDir, 'batch', 'test-app-123');
      const filteredEvents = testHandler.getEvents();
      expect(filteredEvents[1].resultStats.keyCount).toBe(5);
    });
  });

  describe('Context Propagation', () => {
    it('should propagate module context in all events', async () => {
      await memoryTool.setMemory({
        key: 'context.test',
        value: 'test'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      events.forEach(event => {
        expect(event.module).toBe('MemoryTool');
      });
    });

    it('should include operation-specific context', async () => {
      await memoryTool.setMemory({
        key: 'operation.context',
        value: { complex: 'data', with: ['arrays', 'and', 'objects'] }
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      // Both events should have operation context
      expect(events[0].operation).toBe('set');
      expect(events[1].operation).toBe('set');
      
      // Success event should have additional context
      expect(events[1].memoryPath).toContain('.airo-memory');
      expect(events[1].valueType).toBe('object');
    });

    it('should handle missing appId gracefully in logging context', async () => {
      await memoryTool.setMemory({
        key: 'no.appid',
        value: 'test'
      }, testDir); // No appId provided

      const events = testHandler.getEvents();
      
      events.forEach(event => {
        // AppId should not be present in the event
        expect('appId' in event).toBe(false);
        
        // But other context should still be there
        expect(event.toolName).toBe('memory');
        expect(event.key).toBe('no.appid');
        expect(event.operation).toBe('set');
      });
    });
  });

  describe('Error Logging Detail', () => {
    it('should include detailed error information in failure events', async () => {
      await memoryTool.setMemory({
        key: '', // Invalid empty key
        value: 'test'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      const failureEvent = events[1];
      
      expect(failureEvent.event).toBe('tool.memory.set.failure');
      expect(failureEvent.level).toBe('error');
      expect(failureEvent.error).toBeDefined();
      expect(failureEvent.error.message).toBe('Key must be a non-empty string');
      expect(failureEvent.toolName).toBe('memory');
      expect(failureEvent.key).toBe('');
      expect(failureEvent.operation).toBe('set');
    });

    it('should log filesystem errors appropriately', async () => {
      // Try to use an invalid path that should cause filesystem errors
      const invalidPath = '/nonexistent/deeply/nested/path/that/cannot/be/created';
      
      await memoryTool.setMemory({
        key: 'fs.error.test',
        value: 'test'
      }, invalidPath, 'test-app-123');

      const events = testHandler.getEvents();
      
      // Should have begin and failure events
      expect(events).toHaveLength(2);
      expect(events[1].event).toBe('tool.memory.set.failure');
      expect(events[1].error).toBeDefined();
      expect(events[1].error.message).toBeDefined();
    });
  });

  describe('Log Event Structure Validation', () => {
    it('should generate events with consistent structure', async () => {
      await memoryTool.setMemory({
        key: 'structure.test',
        value: 'validation'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      events.forEach(event => {
        // Common fields should be present
        expect(event.event).toBeDefined();
        expect(event.level).toBeDefined();
        expect(event.timestamp).toBeDefined();
        expect(event.toolName).toBe('memory');
        expect(event.module).toBe('MemoryTool');
        
        // Event-specific validation
        if (event.event.includes('begin')) {
          expect(event.operation).toBeDefined();
          expect(event.key).toBeDefined();
        }
        
        if (event.event.includes('success')) {
          expect(event.resultStats).toBeDefined();
          expect(event.resultStats.success).toBe(true);
          expect(event.resultStats.executionTime).toBeTypeOf('number');
        }
        
        if (event.event.includes('failure')) {
          expect(event.error).toBeDefined();
        }
      });
    });

    it('should use correct log levels for different event types', async () => {
      // Success case
      await memoryTool.setMemory({
        key: 'level.test',
        value: 'test'
      }, testDir, testAppId);

      testHandler.clear();

      // Failure case
      await memoryTool.setMemory({
        key: 'invalid/key',
        value: 'test'
      }, testDir, testAppId);

      const events = testHandler.getEvents();
      
      // Begin event should be info level
      expect(events[0].level).toBe('info');
      
      // Failure event should be error level
      expect(events[1].level).toBe('error');
    });
  });
});