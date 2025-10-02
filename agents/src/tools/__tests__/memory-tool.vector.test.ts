/**
 * MemoryTool Vector Search Integration Tests
 * 
 * Tests the Qdrant vector database integration and semantic search functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryTool } from '../memory-tool.js';
import { qdrantService } from '../../services/qdrant-service.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { nanoid } from 'nanoid';

describe('MemoryTool Vector Search Integration Tests', () => {
  let memoryTool: MemoryTool;
  let testDir: string;
  let testAppId: string;
  let appRepository: AppRepository;

  beforeEach(() => {
    // Set up test directory
    testDir = join('/tmp', `memory-vector-test-${Date.now()}`);
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
    createAppStmt.run(testAppId, 'Vector Test App', testDir, 3000, 'test', 'v8', 'created');

    // Create memory tool instance
    memoryTool = new MemoryTool();
    
    // Reset any existing mocks
    vi.clearAllMocks();
    
    // Mock Qdrant service to avoid requiring actual database
    vi.spyOn(qdrantService, 'storeVector').mockResolvedValue({
      success: true,
      id: 'test-id-123'
    });
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
    
    // Restore mocks
    vi.restoreAllMocks();
  });

  describe('Vector Storage Integration', () => {
    it('should store text values in vector database when setting memory', async () => {
      const setResult = await memoryTool.setMemory({
        key: 'user.profile.bio',
        value: 'John is a software developer who loves building web applications with React and Node.js'
      }, testDir, testAppId);

      expect(setResult.success).toBe(true);
      
      // Verify that qdrantService.storeVector was called
      expect(qdrantService.storeVector).toHaveBeenCalledWith({
        key: 'user.profile.bio',
        value: 'John is a software developer who loves building web applications with React and Node.js',
        text: 'John is a software developer who loves building web applications with React and Node.js',
        metadata: {
          appId: testAppId,
          timestamp: expect.any(String),
          type: 'text'
        }
      });
    });

    it('should store object values with extracted text in vector database', async () => {
      const userConfig = {
        theme: 'dark',
        language: 'english',
        preferences: {
          notifications: true,
          emailUpdates: false
        }
      };

      const setResult = await memoryTool.setMemory({
        key: 'user.settings.config',
        value: userConfig
      }, testDir, testAppId);

      expect(setResult.success).toBe(true);
      
      // Verify that qdrantService.storeVector was called with extracted text
      const storeCall = vi.mocked(qdrantService.storeVector).mock.calls[0][0];
      expect(storeCall.key).toBe('user.settings.config');
      expect(storeCall.value).toEqual(userConfig);
      expect(storeCall.text).toContain('theme');
      expect(storeCall.text).toContain('dark');
      expect(storeCall.text).toContain('language');
      expect(storeCall.text).toContain('english');
      expect(storeCall.text).toContain('preferences');
      expect(storeCall.text).toContain('notifications');
      expect(storeCall.text).toContain('emailUpdates');
    });

    it('should handle vector storage failures gracefully', async () => {
      // Mock vector storage failure
      vi.spyOn(qdrantService, 'storeVector').mockResolvedValue({
        success: false,
        error: 'Qdrant connection failed'
      });

      // File storage should still succeed even if vector storage fails
      const setResult = await memoryTool.setMemory({
        key: 'test.key',
        value: 'test value'
      }, testDir, testAppId);

      expect(setResult.success).toBe(true);
    });
  });

  describe('Semantic Search', () => {
    it('should perform semantic search using Qdrant', async () => {
      // Mock successful search results
      vi.spyOn(qdrantService, 'searchVectors').mockResolvedValue({
        success: true,
        results: [
          {
            key: 'user.profile.bio',
            value: 'John is a software developer',
            score: 0.95,
            metadata: { appId: testAppId }
          },
          {
            key: 'team.description',
            value: 'A team of experienced developers',
            score: 0.82
          }
        ]
      });

      const searchResult = await memoryTool.searchMemory({
        query: 'developer programming',
        limit: 5,
        score_threshold: 0.8
      }, testDir, testAppId);

      expect(searchResult.success).toBe(true);
      expect(searchResult.results).toHaveLength(2);
      
      // Verify search parameters
      expect(qdrantService.searchVectors).toHaveBeenCalledWith({
        query: 'developer programming',
        limit: 5,
        score_threshold: 0.8
      });

      // Check result structure
      expect(searchResult.results![0]).toEqual({
        key: 'user.profile.bio',
        value: 'John is a software developer',
        score: 0.95,
        metadata: { appId: testAppId }
      });
    });

    it('should handle empty search results', async () => {
      // Mock empty search results
      vi.spyOn(qdrantService, 'searchVectors').mockResolvedValue({
        success: true,
        results: []
      });

      const searchResult = await memoryTool.searchMemory({
        query: 'nonexistent term',
        limit: 10
      }, testDir, testAppId);

      expect(searchResult.success).toBe(true);
      expect(searchResult.results).toEqual([]);
    });

    it('should handle vector search failures', async () => {
      // Mock search failure
      vi.spyOn(qdrantService, 'searchVectors').mockResolvedValue({
        success: false,
        error: 'Vector search failed'
      });

      const searchResult = await memoryTool.searchMemory({
        query: 'test query'
      }, testDir, testAppId);

      // Memory tool falls back to database text search when vector search fails
      // So it should still succeed, just without vector results
      expect(searchResult.success).toBe(true);
      expect(searchResult.results).toBeDefined();
    });

    it('should validate search query input', async () => {
      const searchResult = await memoryTool.searchMemory({
        query: '',
        limit: 10
      }, testDir, testAppId);

      expect(searchResult.success).toBe(false);
      expect(searchResult.error).toContain('Query must be a non-empty string');
    });

    it('should use default parameters for optional search options', async () => {
      vi.spyOn(qdrantService, 'searchVectors').mockResolvedValue({
        success: true,
        results: []
      });

      await memoryTool.searchMemory({
        query: 'test query'
      }, testDir, testAppId);

      // Verify default parameters are used
      expect(qdrantService.searchVectors).toHaveBeenCalledWith({
        query: 'test query',
        limit: 10,
        score_threshold: 0.7
      });
    });
  });

  describe('Text Extraction', () => {
    it('should extract searchable text from string values', async () => {
      await memoryTool.setMemory({
        key: 'simple.text',
        value: 'This is a simple text string'
      }, testDir, testAppId);

      const storeCall = vi.mocked(qdrantService.storeVector).mock.calls[0][0];
      expect(storeCall.text).toBe('This is a simple text string');
    });

    it('should extract searchable text from numbers and booleans', async () => {
      await memoryTool.setMemory({
        key: 'config.port',
        value: 3000
      }, testDir, testAppId);

      const storeCall = vi.mocked(qdrantService.storeVector).mock.calls[0][0];
      expect(storeCall.text).toBe('3000');
    });

    it('should extract searchable text from complex objects', async () => {
      const complexObject = {
        user: {
          name: 'John Doe',
          settings: {
            theme: 'dark',
            notifications: true
          }
        },
        features: ['dashboard', 'analytics', 'reporting']
      };

      await memoryTool.setMemory({
        key: 'app.config',
        value: complexObject
      }, testDir, testAppId);

      const storeCall = vi.mocked(qdrantService.storeVector).mock.calls[0][0];
      const extractedText = storeCall.text;
      
      // Should include property names and values
      expect(extractedText).toContain('user');
      expect(extractedText).toContain('John Doe');
      expect(extractedText).toContain('settings');
      expect(extractedText).toContain('theme');
      expect(extractedText).toContain('dark');
      expect(extractedText).toContain('notifications');
      expect(extractedText).toContain('dashboard');
      expect(extractedText).toContain('analytics');
    });

    it('should handle null and undefined values', async () => {
      await memoryTool.setMemory({
        key: 'nullable.value',
        value: null
      }, testDir, testAppId);

      // Null values result in empty text, so no vector storage call is made
      const calls = vi.mocked(qdrantService.storeVector).mock.calls;
      expect(calls).toHaveLength(0);
    });
  });
});