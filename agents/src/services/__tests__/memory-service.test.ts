import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryService } from '../memory-service.js';

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let testAppPath: string;
  const testAppId = 'test-app-123';

  beforeEach(async () => {
    memoryService = new MemoryService();
    testAppPath = await mkdtemp(join(tmpdir(), 'memory-test-'));
  });

  afterEach(async () => {
    await rm(testAppPath, { recursive: true, force: true });
  });

  describe('set', () => {
    it('should create a new memory entry', async () => {
      const entry = await memoryService.set(
        testAppPath,
        testAppId,
        'app.title',
        'My Test App'
      );

      expect(entry.fullKey).toBe('app.title');
      expect(entry.namespace).toBe('app');
      expect(entry.key).toBe('title');
      expect(entry.value).toBe('My Test App');
      expect(entry.type).toBe('string');
      expect(entry.createdAt).toBeDefined();
      expect(entry.updatedAt).toBeDefined();
    });

    it('should update an existing memory entry', async () => {
      const entry1 = await memoryService.set(
        testAppPath,
        testAppId,
        'app.title',
        'Original Title'
      );

      const entry2 = await memoryService.set(
        testAppPath,
        testAppId,
        'app.title',
        'Updated Title'
      );

      expect(entry2.value).toBe('Updated Title');
      expect(entry2.createdAt).toBe(entry1.createdAt);
      expect(entry2.updatedAt).not.toBe(entry1.updatedAt);
    });

    it('should store complex objects', async () => {
      const complexValue = {
        name: 'Test',
        count: 42,
        enabled: true,
        tags: ['tag1', 'tag2'],
      };

      const entry = await memoryService.set(
        testAppPath,
        testAppId,
        'app.config',
        complexValue
      );

      expect(entry.value).toEqual(complexValue);
      expect(entry.type).toBe('object');
    });

    it('should reject keys without dots', async () => {
      await expect(
        memoryService.set(testAppPath, testAppId, 'invalidkey', 'value')
      ).rejects.toThrow('Key must contain at least one dot');
    });

    it('should reject keys with invalid characters', async () => {
      await expect(
        memoryService.set(testAppPath, testAppId, 'app/title', 'value')
      ).rejects.toThrow('Key can only contain alphanumeric characters');
    });

    it('should reject values exceeding size limit', async () => {
      const largeValue = 'x'.repeat(200 * 1024);

      await expect(
        memoryService.set(testAppPath, testAppId, 'app.large', largeValue)
      ).rejects.toThrow('Value size');
    });
  });

  describe('get', () => {
    it('should retrieve an existing entry', async () => {
      await memoryService.set(testAppPath, testAppId, 'app.title', 'Test App');

      const entry = await memoryService.get(testAppPath, 'app.title');

      expect(entry).toBeDefined();
      expect(entry?.value).toBe('Test App');
    });

    it('should return null for non-existent entry', async () => {
      const entry = await memoryService.get(testAppPath, 'app.missing');

      expect(entry).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing entry', async () => {
      await memoryService.set(testAppPath, testAppId, 'app.title', 'Test App');

      const deleted = await memoryService.delete(testAppPath, testAppId, 'app.title');

      expect(deleted).toBe(true);

      const entry = await memoryService.get(testAppPath, 'app.title');
      expect(entry).toBeNull();
    });

    it('should return false for non-existent entry', async () => {
      const deleted = await memoryService.delete(testAppPath, testAppId, 'app.missing');

      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await memoryService.set(testAppPath, testAppId, 'app.title', 'Test App');
      await memoryService.set(testAppPath, testAppId, 'app.version', '1.0.0');
      await memoryService.set(testAppPath, testAppId, 'database.host', 'localhost');
      await memoryService.set(testAppPath, testAppId, 'database.port', 3306);
    });

    it('should list all entries', async () => {
      const entries = await memoryService.list(testAppPath);

      expect(entries).toHaveLength(4);
      expect(entries.map(e => e.fullKey)).toContain('app.title');
      expect(entries.map(e => e.fullKey)).toContain('database.host');
    });

    it('should filter by prefix', async () => {
      const entries = await memoryService.list(testAppPath, 'app');

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.fullKey.startsWith('app'))).toBe(true);
    });

    it('should return empty array for no matches', async () => {
      const entries = await memoryService.list(testAppPath, 'missing');

      expect(entries).toHaveLength(0);
    });
  });

  describe('batchGet', () => {
    beforeEach(async () => {
      await memoryService.set(testAppPath, testAppId, 'app.title', 'Test App');
      await memoryService.set(testAppPath, testAppId, 'app.version', '1.0.0');
      await memoryService.set(testAppPath, testAppId, 'database.host', 'localhost');
    });

    it('should retrieve multiple entries', async () => {
      const entries = await memoryService.batchGet(testAppPath, [
        'app.title',
        'app.version',
        'database.host',
      ]);

      expect(Object.keys(entries)).toHaveLength(3);
      expect(entries['app.title'].value).toBe('Test App');
      expect(entries['app.version'].value).toBe('1.0.0');
      expect(entries['database.host'].value).toBe('localhost');
    });

    it('should omit missing keys', async () => {
      const entries = await memoryService.batchGet(testAppPath, [
        'app.title',
        'app.missing',
        'database.host',
      ]);

      expect(Object.keys(entries)).toHaveLength(2);
      expect(entries['app.title']).toBeDefined();
      expect(entries['database.host']).toBeDefined();
      expect(entries['app.missing']).toBeUndefined();
    });
  });
});
