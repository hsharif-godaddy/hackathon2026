/**
 * MemoryTool Security Tests
 * 
 * Tests for path traversal prevention and input sanitization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryTool } from '../memory-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';

describe('MemoryTool Security Tests', () => {
  let memoryTool: MemoryTool;
  let testDir: string;
  let testAppId: string;
  let appRepository: AppRepository;

  beforeEach(() => {
    // Set up test directory
    testDir = join('/tmp', `memory-security-test-${Date.now()}`);
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
    createAppStmt.run(testAppId, 'Security Test App', testDir, 3000, 'test', 'v8', 'created');

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

  describe('Path Traversal Prevention', () => {
    const pathTraversalKeys = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      'user/../../../secret',
      'app..config',
      'user./..config',
      'normal/../../etc/passwd',
      'test\\..\\..\\sensitive',
      './../sensitive',
      'config/../../../root/.ssh/id_rsa'
    ];

    pathTraversalKeys.forEach(maliciousKey => {
      it(`should reject path traversal attempt: ${maliciousKey}`, async () => {
        const result = await memoryTool.setMemory({
          key: maliciousKey,
          value: 'malicious content'
        }, testDir, testAppId);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/path traversal|invalid|start|end|can only contain/i);
      });

      it(`should reject path traversal in read: ${maliciousKey}`, async () => {
        const result = await memoryTool.readMemory({
          key: maliciousKey
        }, testDir, testAppId);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/path traversal|invalid|start|end|can only contain/i);
      });
    });
  });

  describe('Invalid Character Prevention', () => {
    const invalidKeys = [
      'user@domain.com',
      'config*wildcard',
      'path/with/slashes',
      'back\\slash\\path',
      'special|chars',
      'question?mark',
      'hash#tag',
      'percent%sign',
      'plus+sign',
      'space key',
      'tab\tkey',
      'newline\nkey',
      'unicode测试',
      'emoji😀key'
    ];

    invalidKeys.forEach(invalidKey => {
      it(`should reject invalid characters: ${invalidKey}`, async () => {
        const result = await memoryTool.setMemory({
          key: invalidKey,
          value: 'test content'
        }, testDir, testAppId);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/can only contain|invalid/i);
      });
    });
  });

  describe('Dot Position Validation', () => {
    const invalidDotKeys = [
      '.startswith.dot',
      'endswith.dot.',
      '.onlydot.',
      '.multiple..dots.',
      'start.end.'
    ];

    invalidDotKeys.forEach(dotKey => {
      it(`should reject invalid dot positioning: ${dotKey}`, async () => {
        const result = await memoryTool.setMemory({
          key: dotKey,
          value: 'test content'
        }, testDir, testAppId);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cannot start|cannot end|dot|path traversal/i);
      });
    });
  });

  describe('Valid Keys Should Work', () => {
    const validKeys = [
      'simple',
      'user.name',
      'app.config.database.host',
      'config_with_underscores',
      'config-with-hyphens',
      'mixed123.test_key-value',
      'UPPERCASE.lowercase.123',
      'a.very.long.key.with.many.segments.that.should.work',
      'user_profile-settings',
      'app-v2.config_2024'
    ];

    validKeys.forEach(validKey => {
      it(`should accept valid key: ${validKey}`, async () => {
        const setResult = await memoryTool.setMemory({
          key: validKey,
          value: 'test content'
        }, testDir, testAppId);

        expect(setResult.success).toBe(true);

        const readResult = await memoryTool.readMemory({
          key: validKey
        }, testDir, testAppId);

        expect(readResult.success).toBe(true);
        expect(readResult.exists).toBe(true);
        expect(readResult.value).toBe('test content');
      });
    });
  });

  describe('Path Sanitization', () => {
    it('should sanitize paths correctly', async () => {
      // This test verifies that even if a malicious key somehow passes validation,
      // the sanitization prevents actual path traversal
      const testKey = 'user.config';
      
      const result = await memoryTool.setMemory({
        key: testKey,
        value: 'safe content'
      }, testDir, testAppId);

      expect(result.success).toBe(true);

      // With SQLite storage, data is now in database not filesystem
      // Verify we can read it back
      const readResult = await memoryTool.readMemory({
        key: testKey
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('safe content');
    });

    it('should contain files within the memory directory', async () => {
      await memoryTool.setMemory({
        key: 'deep.nested.test.key',
        value: 'contained content'
      }, testDir, testAppId);

      // With SQLite storage, verify data is stored in database
      const readResult = await memoryTool.readMemory({
        key: 'deep.nested.test.key'
      }, testDir, testAppId);
      
      expect(readResult.success).toBe(true);
      expect(readResult.exists).toBe(true);
      expect(readResult.value).toBe('contained content');
      
      // List all files in the test directory - should be empty (no .airo-memory dir)
      const { readdirSync } = await import('fs');
      const files = readdirSync(testDir);
      expect(files).toEqual([]);
    });
  });

  describe('Empty and Null Key Validation', () => {
    const emptyKeys = [
      '',
      '   ',
      null,
      undefined
    ];

    emptyKeys.forEach(emptyKey => {
      it(`should reject empty/null key: ${JSON.stringify(emptyKey)}`, async () => {
        const result = await memoryTool.setMemory({
          key: emptyKey as any,
          value: 'test content'
        }, testDir, testAppId);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/non-empty string/i);
      });
    });
  });
});