/**
 * BlogPostRepository Integration Test
 *
 * Tests real SQLite date comparisons to verify datetime filtering works correctly.
 * This catches issues that mocked tests miss (e.g., ISO string vs datetime('now') comparison bug).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BlogPostRepository } from '../BlogPostRepository.js';
import { initializeSchema } from '../../schema.js';
import fs from 'fs';
import path from 'path';

describe('BlogPostRepository Integration Tests', () => {
  let db: Database.Database;
  let repository: BlogPostRepository;
  const testDbPath = path.join(process.cwd(), 'test-blog-integration.db');

  beforeEach(async () => {
    // Create fresh test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    db = new Database(testDbPath);
    initializeSchema(db);

    // Disable FK checks for test (apps table doesn't exist in this test db)
    db.exec('PRAGMA foreign_keys = OFF');

    // Mock getDatabase to return our test db
    const connectionModule = await import('../../connection.js');
    vi.spyOn(connectionModule, 'getDatabase').mockReturnValue(db);

    repository = new BlogPostRepository();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('findPublishedDue - Date Comparison', () => {
    it('should find posts published earlier today (same UTC day)', () => {
      const appId = 'app-123';

      // Create post published 2 hours ago (same day)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const post = repository.create({
        appId,
        slug: 'same-day-post',
        title: 'Same Day Post',
        contentMarkdown: '# Published earlier today',
        published: true,
        publishedAt: twoHoursAgo,
      });

      // Find published posts
      const results = repository.findPublishedDue(appId);

      // Should find the post published earlier today
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(post.id);
      expect(results[0].title).toBe('Same Day Post');
    });

    it('should find posts published yesterday', () => {
      const appId = 'app-123';

      // Create post published yesterday
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const post = repository.create({
        appId,
        slug: 'yesterday-post',
        title: 'Yesterday Post',
        contentMarkdown: '# Published yesterday',
        published: true,
        publishedAt: yesterday,
      });

      const results = repository.findPublishedDue(appId);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(post.id);
    });

    it('should NOT find posts scheduled for future (same day)', () => {
      const appId = 'app-123';

      // Create post scheduled 2 hours from now (same day)
      const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000);

      repository.create({
        appId,
        slug: 'future-post',
        title: 'Future Post',
        contentMarkdown: '# Scheduled for later today',
        published: true,
        publishedAt: twoHoursLater,
      });

      const results = repository.findPublishedDue(appId);

      // Should NOT find future-scheduled posts
      expect(results).toHaveLength(0);
    });

    it('should NOT find posts scheduled for tomorrow', () => {
      const appId = 'app-123';

      // Create post scheduled for tomorrow
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      repository.create({
        appId,
        slug: 'tomorrow-post',
        title: 'Tomorrow Post',
        contentMarkdown: '# Scheduled for tomorrow',
        published: true,
        publishedAt: tomorrow,
      });

      const results = repository.findPublishedDue(appId);

      expect(results).toHaveLength(0);
    });

    it('should find posts published exactly now (edge case)', () => {
      const appId = 'app-123';

      // Create post with current timestamp
      const now = new Date();

      const post = repository.create({
        appId,
        slug: 'now-post',
        title: 'Now Post',
        contentMarkdown: '# Published right now',
        published: true,
        publishedAt: now,
      });

      // Small delay to ensure "now" has passed
      const results = repository.findPublishedDue(appId);

      // Should find the post (published_at <= now)
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(post.id);
    });

    it('should correctly order posts by published_at DESC', () => {
      const appId = 'app-123';

      // Create posts with different timestamps
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      repository.create({
        appId,
        slug: 'old-post',
        title: 'Old Post',
        contentMarkdown: '# Old',
        published: true,
        publishedAt: threeDaysAgo,
      });

      repository.create({
        appId,
        slug: 'recent-post',
        title: 'Recent Post',
        contentMarkdown: '# Recent',
        published: true,
        publishedAt: oneDayAgo,
      });

      repository.create({
        appId,
        slug: 'middle-post',
        title: 'Middle Post',
        contentMarkdown: '# Middle',
        published: true,
        publishedAt: twoDaysAgo,
      });

      const results = repository.findPublishedDue(appId);

      // Should return in DESC order (newest first)
      expect(results).toHaveLength(3);
      expect(results[0].title).toBe('Recent Post');
      expect(results[1].title).toBe('Middle Post');
      expect(results[2].title).toBe('Old Post');
    });

    it('should handle mixed published and unpublished posts', () => {
      const appId = 'app-123';

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Published post
      repository.create({
        appId,
        slug: 'published',
        title: 'Published',
        contentMarkdown: '# Published',
        published: true,
        publishedAt: yesterday,
      });

      // Draft (published=false)
      repository.create({
        appId,
        slug: 'draft',
        title: 'Draft',
        contentMarkdown: '# Draft',
        published: false,
        publishedAt: yesterday,
      });

      const results = repository.findPublishedDue(appId);

      // Should only find published post
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Published');
    });
  });
});
