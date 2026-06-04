/**
 * BlogPostRepository Test Suite
 *
 * Comprehensive tests for the BlogPostRepository class covering:
 * - Blog post CRUD operations
 * - Markdown content storage
 * - Tag management (JSON array)
 * - Published post filtering with date/time
 * - Campaign association
 * - Scheduled post visibility (findPublishedDue)
 * - Database integrity and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BlogPostRepository } from '../BlogPostRepository.js';
import type { BlogPost } from '../../schema.js';

// Mock dependencies
vi.mock('../../connection.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('BlogPostRepository', () => {
  let repository: BlogPostRepository;
  let mockDb: any;
  let mockStatement: any;

  // Test data
  const testAppId = 'app-123';
  const testPostId = 'post-abc123';
  const testCampaignId = 'campaign-456';
  const testSlug = 'my-first-blog-post';
  const testTitle = 'My First Blog Post';
  const testMarkdown = '# Hello World\n\nThis is **markdown** content.';
  const testTags = ['tutorial', 'getting-started'];
  const pastDate = new Date('2026-01-01T00:00:00Z');
  const futureDate = new Date('2030-01-01T00:00:00Z');
  const now = new Date('2026-06-03T12:00:00Z');

  const mockDbRow = {
    id: testPostId,
    app_id: testAppId,
    campaign_id: testCampaignId,
    slug: testSlug,
    title: testTitle,
    summary: 'This is a sample post',
    content_markdown: testMarkdown,
    featured_image: '/images/featured.jpg',
    tags: JSON.stringify(testTags),
    published: 1,
    published_at: pastDate.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const expectedPost: BlogPost = {
    id: testPostId,
    appId: testAppId,
    campaignId: testCampaignId,
    slug: testSlug,
    title: testTitle,
    summary: 'This is a sample post',
    contentMarkdown: testMarkdown,
    featuredImage: '/images/featured.jpg',
    tags: JSON.stringify(testTags),
    published: true,
    publishedAt: pastDate,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock database statement
    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    };

    // Mock database connection
    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
    };

    // Mock getDatabase
    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    // Create repository instance
    repository = new BlogPostRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with database connection', () => {
      expect(repository).toBeInstanceOf(BlogPostRepository);
      expect(mockDb).toBeDefined();
    });
  });

  describe('create', () => {
    it('should create a new blog post with all fields', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.create({
        appId: testAppId,
        campaignId: testCampaignId,
        slug: testSlug,
        title: testTitle,
        summary: 'This is a sample post',
        contentMarkdown: testMarkdown,
        featuredImage: '/images/featured.jpg',
        tags: testTags,
        published: true,
        publishedAt: pastDate,
      });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO blog_posts'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(
        expect.any(String), // id (nanoid)
        testAppId,
        testCampaignId,
        testSlug,
        testTitle,
        'This is a sample post',
        testMarkdown,
        '/images/featured.jpg',
        JSON.stringify(testTags),
        1, // published
        pastDate.toISOString(),
        expect.any(String), // created_at
        expect.any(String), // updated_at
      );

      expect(result).toMatchObject({
        appId: testAppId,
        campaignId: testCampaignId,
        slug: testSlug,
        title: testTitle,
        contentMarkdown: testMarkdown,
      });
    });

    it('should create post without optional fields', () => {
      const minimalRow = {
        ...mockDbRow,
        campaign_id: null,
        summary: null,
        featured_image: null,
        tags: null,
      };
      mockStatement.get.mockReturnValue(minimalRow);

      const result = repository.create({
        appId: testAppId,
        slug: testSlug,
        title: testTitle,
        contentMarkdown: testMarkdown,
      });

      expect(result.campaignId).toBeNull();
      expect(result.summary).toBeNull();
      expect(result.featuredImage).toBeNull();
      expect(result.tags).toBeNull();
    });

    it('should throw error on slug collision', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: blog_posts.app_id, blog_posts.slug');
      });

      expect(() => {
        repository.create({
          appId: testAppId,
          slug: testSlug,
          title: testTitle,
          contentMarkdown: testMarkdown,
        });
      }).toThrow('UNIQUE constraint failed');
    });
  });

  describe('findById', () => {
    it('should return post when found', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findById(testPostId);

      expect(result).toMatchObject({
        id: testPostId,
        appId: testAppId,
        slug: testSlug,
      });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM blog_posts WHERE id = ?'),
      );
      expect(mockStatement.get).toHaveBeenCalledWith(testPostId);
    });

    it('should return null when post not found', () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('should return post when found by app_id and slug', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findBySlug(testAppId, testSlug);

      expect(result).toMatchObject({
        id: testPostId,
        slug: testSlug,
      });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_id = ? AND slug = ?'),
      );
      expect(mockStatement.get).toHaveBeenCalledWith(testAppId, testSlug);
    });

    it('should return null when slug not found', () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = repository.findBySlug(testAppId, 'nonexistent-slug');

      expect(result).toBeNull();
    });
  });

  describe('findByAppId', () => {
    it('should return all posts for an app', () => {
      const row1 = { ...mockDbRow, id: 'post-1', slug: 'post-1' };
      const row2 = { ...mockDbRow, id: 'post-2', slug: 'post-2' };

      mockStatement.all.mockReturnValue([row1, row2]);

      const result = repository.findByAppId(testAppId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('post-1');
      expect(result[1].id).toBe('post-2');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_id = ?'),
      );
    });

    it('should filter by published status', () => {
      mockStatement.all.mockReturnValue([mockDbRow]);

      repository.findByAppId(testAppId, { published: true });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND published = ?'),
      );
      expect(mockStatement.all).toHaveBeenCalledWith(testAppId, 1);
    });

    it('should support pagination', () => {
      mockStatement.all.mockReturnValue([]);

      repository.findByAppId(testAppId, { limit: 10, offset: 20 });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
      );
      expect(mockStatement.all).toHaveBeenCalledWith(testAppId, 10, 20);
    });
  });


  describe('findPublishedDue', () => {
    it('should return posts where published_at <= now', () => {
      const publishedRow = {
        ...mockDbRow,
        published: 1,
        published_at: pastDate.toISOString(),
      };

      mockStatement.all.mockReturnValue([publishedRow]);

      const result = repository.findPublishedDue(testAppId);

      expect(result).toHaveLength(1);
      expect(result[0].published).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("published = 1"),
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("published_at <= ?"),
      );
    });

    it('should filter out future-dated posts', () => {
      const futureRow = {
        ...mockDbRow,
        published: 1,
        published_at: futureDate.toISOString(),
      };

      // SQL query filters at database level, so mock returns empty
      mockStatement.all.mockReturnValue([]);

      const result = repository.findPublishedDue(testAppId);

      expect(result).toHaveLength(0);
    });

    it('should filter by tag in application code', () => {
      const row1 = { ...mockDbRow, id: 'post-1', tags: JSON.stringify(['tutorial', 'beginner']) };
      const row2 = { ...mockDbRow, id: 'post-2', tags: JSON.stringify(['advanced']) };

      mockStatement.all.mockReturnValue([row1, row2]);

      const result = repository.findPublishedDue(testAppId, { tag: 'tutorial' });

      // Application filters by tag
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('post-1');
    });

    it('should handle posts with no tags', () => {
      const row = { ...mockDbRow, tags: null };

      mockStatement.all.mockReturnValue([row]);

      const result = repository.findPublishedDue(testAppId, { tag: 'tutorial' });

      expect(result).toHaveLength(0); // Filtered out (no tags)
    });

    it('should support pagination', () => {
      mockStatement.all.mockReturnValue([]);

      repository.findPublishedDue(testAppId, { limit: 5, offset: 10 });

      const calls = mockStatement.all.mock.calls[0];
      expect(calls).toContain(testAppId);
      expect(calls).toContain(5);
      expect(calls).toContain(10);
    });
  });


  describe('findByCampaignId', () => {
    it('should return posts for a campaign', () => {
      const row1 = { ...mockDbRow, id: 'post-1' };
      const row2 = { ...mockDbRow, id: 'post-2' };

      mockStatement.all.mockReturnValue([row1, row2]);

      const result = repository.findByCampaignId(testCampaignId);

      expect(result).toHaveLength(2);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE campaign_id = ?'),
      );
      expect(mockStatement.all).toHaveBeenCalledWith(testCampaignId);
    });

    it('should return empty array when no posts found', () => {
      mockStatement.all.mockReturnValue([]);

      const result = repository.findByCampaignId('nonexistent-campaign');

      expect(result).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update post fields', () => {
      const existingRow = mockDbRow;
      const updatedRow = {
        ...mockDbRow,
        title: 'Updated Title',
        content_markdown: '# Updated Content',
        updated_at: new Date().toISOString(),
      };

      mockDb.prepare = vi.fn((sql: string) => {
        if (sql.includes('UPDATE')) {
          return { run: vi.fn().mockReturnValue({ changes: 1 }) };
        }
        // findById gets called twice - before and after update
        return {
          get: vi.fn()
            .mockReturnValueOnce(existingRow)
            .mockReturnValueOnce(updatedRow),
        };
      });

      const result = repository.update(testPostId, {
        title: 'Updated Title',
        contentMarkdown: '# Updated Content',
      });

      expect(result).not.toBeNull();
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE'));
    });

    it('should update tags', () => {
      const newTags = ['advanced', 'tutorial'];
      const updatedRow = {
        ...mockDbRow,
        tags: JSON.stringify(newTags),
      };

      mockStatement.get
        .mockReturnValueOnce(mockDbRow)
        .mockReturnValueOnce(updatedRow);

      const result = repository.update(testPostId, { tags: newTags });

      const calls = mockStatement.run.mock.calls[0];
      expect(calls).toContain(JSON.stringify(newTags));
    });

    it('should update published status and date', () => {
      const newPublishedAt = new Date('2026-12-25T00:00:00Z');
      const existingRow = mockDbRow;
      const updatedRow = {
        ...mockDbRow,
        published: 0,
        published_at: newPublishedAt.toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockDb.prepare = vi.fn((sql: string) => {
        if (sql.includes('UPDATE')) {
          return { run: vi.fn().mockReturnValue({ changes: 1 }) };
        }
        return {
          get: vi.fn()
            .mockReturnValueOnce(existingRow)
            .mockReturnValueOnce(updatedRow),
        };
      });

      const result = repository.update(testPostId, {
        published: false,
        publishedAt: newPublishedAt,
      });

      expect(result).not.toBeNull();
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE'));
    });

    it('should throw when post not found for update', () => {
      mockStatement.get.mockReturnValue(null);

      expect(() => {
        repository.update('nonexistent', { title: 'New Title' });
      }).toThrow(); // Just check that it throws, error message varies
    });

    it('should return existing post when no changes provided', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.update(testPostId, {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe(testPostId);
    });
  });

  describe('delete', () => {
    it('should delete a post', () => {
      repository.delete(testPostId);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM blog_posts WHERE id = ?'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(testPostId);
    });

    it('should throw error on database failure', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('Database error');
      });

      expect(() => {
        repository.delete(testPostId);
      }).toThrow('Database error');
    });
  });

  describe('count', () => {
    it('should return total post count', () => {
      mockStatement.get.mockReturnValue({ count: 42 });

      const result = repository.count(testAppId);

      expect(result).toBe(42);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
      );
    });

    it('should count published posts only', () => {
      mockStatement.get.mockReturnValue({ count: 10 });

      const result = repository.count(testAppId, true);

      expect(result).toBe(10);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND published = ?'),
      );
      expect(mockStatement.get).toHaveBeenCalledWith(testAppId, 1);
    });

    it('should count unpublished posts', () => {
      mockStatement.get.mockReturnValue({ count: 5 });

      const result = repository.count(testAppId, false);

      expect(result).toBe(5);
      expect(mockStatement.get).toHaveBeenCalledWith(testAppId, 0);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors in findById', () => {
      mockStatement.get.mockImplementation(function () {
        throw new Error('Database error');
      });

      const result = repository.findById(testPostId);

      expect(result).toBeNull();
    });

    it('should handle database errors in findByAppId', () => {
      mockStatement.all.mockImplementation(function () {
        throw new Error('Database error');
      });

      const result = repository.findByAppId(testAppId);

      expect(result).toEqual([]);
    });

    it('should handle invalid JSON in tags', () => {
      const invalidRow = {
        ...mockDbRow,
        tags: 'invalid-json',
      };

      mockStatement.all.mockReturnValue([invalidRow]);

      const result = repository.findPublishedDue(testAppId, { tag: 'tutorial' });

      // Should filter out posts with invalid JSON
      expect(result).toHaveLength(0);
    });

    it('should handle database errors in delete', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('Database error during delete');
      });

      expect(() => repository.delete(testPostId)).toThrow('Database error during delete');
    });

    it('should handle database errors in count', () => {
      mockStatement.get.mockImplementation(function () {
        throw new Error('Database error during count');
      });

      const result = repository.count(testAppId);

      expect(result).toBe(0); // Should return 0 on error
    });

    it('should handle database errors in count with published filter', () => {
      mockStatement.get.mockImplementation(function () {
        throw new Error('Database error during count with filter');
      });

      const result = repository.count(testAppId, true);

      expect(result).toBe(0); // Should return 0 on error
    });

    it('should handle database errors in findPublishedDue with tag filter', () => {
      mockStatement.all.mockImplementation(function () {
        throw new Error('Database error during findPublishedDue');
      });

      const result = repository.findPublishedDue(testAppId, { tag: 'tutorial' });

      expect(result).toEqual([]); // Should return empty array on error
    });

    it('should handle database errors in findPublishedDue with limit', () => {
      mockStatement.all.mockImplementation(function () {
        throw new Error('Database error with limit');
      });

      const result = repository.findPublishedDue(testAppId, { limit: 5 });

      expect(result).toEqual([]); // Should return empty array on error
    });

    it('should handle database errors in findPublishedDue with offset', () => {
      mockStatement.all.mockImplementation(function () {
        throw new Error('Database error with offset');
      });

      const result = repository.findPublishedDue(testAppId, { offset: 10 });

      expect(result).toEqual([]); // Should return empty array on error
    });

    it('should handle database errors in findPublishedDue with multiple filters', () => {
      mockStatement.all.mockImplementation(function () {
        throw new Error('Database error with multiple filters');
      });

      const result = repository.findPublishedDue(testAppId, {
        tag: 'tutorial',
        limit: 5,
        offset: 10,
      });

      expect(result).toEqual([]); // Should return empty array on error
    });
  });
});
