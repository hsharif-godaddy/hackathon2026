import fs from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearScheduledPostsCache, getScheduledPostsForMonth, scanScheduledPosts } from './scan-scheduled-posts';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('@/lib/dev-environment/utils/app-paths', () => ({
  getAppPath: vi.fn((appId: string) => `/tmp/apps/${appId}/app`),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => {
    // Simple frontmatter parser for testing
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { data: {}, content };

    const frontmatter = match[1];
    const data: any = {};

    frontmatter.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        data[key.trim()] = valueParts.join(':').trim();
      }
    });

    return { data, content: content.substring(match[0].length) };
  }),
}));

describe('scan-scheduled-posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearScheduledPostsCache(); // Clear cache between tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearScheduledPostsCache(); // Clean up after tests
  });

  describe('scanScheduledPosts', () => {
    it('should return empty array if blog is not installed', async () => {
      (fs.access as any).mockRejectedValue(new Error('ENOENT'));

      const result = await scanScheduledPosts('test-app-1');

      expect(result).toEqual([]);
    });

    it('should scan and parse markdown files', async () => {
      const mockMarkdownContent = `---
title: Test Post
publishedAt: 2099-12-25T10:00:00Z
---

# Test Content
`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['post1.md', 'post2.mdx', 'README.md', 'other.txt']);
      (fs.readFile as any).mockResolvedValue(mockMarkdownContent);

      const result = await scanScheduledPosts('test-app-2');

      // Should parse 2 markdown files (post1.md, post2.mdx), skip README and non-markdown
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        title: 'Test Post',
        status: 'scheduled', // Future date (2099)
      });
    });

    it('should correctly classify scheduled vs published posts', async () => {
      const scheduledPost = `---
title: Future Post
publishedAt: 2099-12-25T10:00:00Z
---
Content`;

      const publishedPost = `---
title: Past Post
publishedAt: 2020-01-01T10:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['future.md', 'past.md']);
      (fs.readFile as any)
        .mockResolvedValueOnce(scheduledPost)
        .mockResolvedValueOnce(publishedPost);

      const result = await scanScheduledPosts('test-app-3');

      expect(result).toHaveLength(2);
      expect(result.find(p => p.title === 'Future Post')?.status).toBe('scheduled');
      expect(result.find(p => p.title === 'Past Post')?.status).toBe('published');
    });

    it('should handle file system errors gracefully', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockRejectedValue(new Error('Permission denied'));

      const result = await scanScheduledPosts('test-app-4');

      expect(result).toEqual([]);
    });

    it('should skip files with invalid frontmatter', async () => {
      const invalidPost = `---
title: Invalid Post
no publishedAt field
---
Content`;

      const validPost = `---
title: Valid Post
publishedAt: 2025-12-25T10:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['invalid.md', 'valid.md']);
      (fs.readFile as any)
        .mockResolvedValueOnce(invalidPost)
        .mockResolvedValueOnce(validPost);

      const result = await scanScheduledPosts('test-app-5');

      // Should only return the valid post
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Valid Post');
    });
  });

  describe('Cache Behavior', () => {
    it('should return cached data within TTL', async () => {
      const mockPost = `---
title: Cached Post
publishedAt: 2025-12-25T10:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['post.md']);
      (fs.readFile as any).mockResolvedValue(mockPost);

      // First call - should hit file system
      const result1 = await scanScheduledPosts('test-app-cache');
      expect(fs.readdir).toHaveBeenCalledTimes(1);

      // Second call within TTL (30 seconds) - should use cache
      vi.advanceTimersByTime(15000); // 15 seconds
      const result2 = await scanScheduledPosts('test-app-cache');
      expect(fs.readdir).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result2).toEqual(result1);
    });

    it('should re-scan after cache TTL expires', async () => {
      const mockPost = `---
title: Expired Cache Post
publishedAt: 2025-12-25T10:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['post.md']);
      (fs.readFile as any).mockResolvedValue(mockPost);

      // First call
      await scanScheduledPosts('test-app-ttl');
      expect(fs.readdir).toHaveBeenCalledTimes(1);

      // Wait past TTL (30 seconds)
      vi.advanceTimersByTime(31000);

      // Second call - should re-scan
      await scanScheduledPosts('test-app-ttl');
      expect(fs.readdir).toHaveBeenCalledTimes(2);
    });
  });

  describe('Race Condition Prevention', () => {
    it('should prevent concurrent scans for same appId', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const mockPost = `---
title: Concurrent Test
publishedAt: 2025-12-25T10:00:00Z
---
Content`;

      let scanCount = 0;
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockImplementation(async () => {
        scanCount++;
        // Simulate slow file system operation
        await new Promise(resolve => setTimeout(resolve, 50));
        return ['post.md'];
      });
      (fs.readFile as any).mockResolvedValue(mockPost);

      // Fire 3 concurrent requests
      const [result1, result2, result3] = await Promise.all([
        scanScheduledPosts('test-app-concurrent'),
        scanScheduledPosts('test-app-concurrent'),
        scanScheduledPosts('test-app-concurrent'),
      ]);

      // Should only scan once despite 3 concurrent requests
      expect(scanCount).toBe(1);
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);

      vi.useFakeTimers(); // Restore fake timers
    });

    it('should allow concurrent scans for different appIds', async () => {
      const mockPost = `---
title: Different App
publishedAt: 2025-12-25T10:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['post.md']);
      (fs.readFile as any).mockResolvedValue(mockPost);

      // Fire concurrent requests for different apps
      await Promise.all([
        scanScheduledPosts('app-1'),
        scanScheduledPosts('app-2'),
        scanScheduledPosts('app-3'),
      ]);

      // Should scan all three apps
      expect(fs.readdir).toHaveBeenCalledTimes(3);
    });
  });

  describe('getScheduledPostsForMonth', () => {
    it('should filter posts by month', async () => {
      const januaryPost = `---
title: January Post
publishedAt: 2024-01-15T10:00:00Z
---
Content`;

      const februaryPost = `---
title: February Post
publishedAt: 2024-02-20T10:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['jan.md', 'feb.md']);
      (fs.readFile as any)
        .mockResolvedValueOnce(januaryPost)
        .mockResolvedValueOnce(februaryPost);

      // First scan to populate cache
      await scanScheduledPosts('test-app-month');

      // Then filter by month
      const result = await getScheduledPostsForMonth(
        'test-app-month',
        new Date(2024, 0, 1) // January 2024
      );

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('January Post');
    });

    it('should handle timezone correctly', async () => {
      // Post published mid-month at noon UTC - safe for any timezone
      const utcPost = `---
title: UTC Post
publishedAt: 2024-01-15T12:00:00Z
---
Content`;

      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['post.md']);
      (fs.readFile as any).mockResolvedValue(utcPost);

      // First scan to populate cache
      await scanScheduledPosts('test-app-tz');

      // Then filter by month
      const result = await getScheduledPostsForMonth(
        'test-app-tz',
        new Date(2024, 0, 1) // January 2024
      );

      // Should be in January regardless of local timezone
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('UTC Post');
    });
  });

  describe('File System Error Handling', () => {
    it('should handle EACCES (permission denied) errors', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      const error = new Error('Permission denied');
      (error as any).code = 'EACCES';
      (fs.readdir as any).mockRejectedValue(error);

      const result = await scanScheduledPosts('test-app-permission');

      expect(result).toEqual([]);
    });

    it('should handle ENOENT (file not found) errors', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['post.md']);
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      (fs.readFile as any).mockRejectedValue(error);

      const result = await scanScheduledPosts('test-app-notfound');

      // Should skip the file that doesn't exist
      expect(result).toEqual([]);
    });

    it('should handle corrupted file content', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readdir as any).mockResolvedValue(['corrupted.md']);
      (fs.readFile as any).mockResolvedValue('Not valid YAML frontmatter\n---\nweird format');

      const result = await scanScheduledPosts('test-app-corrupted');

      // Should skip corrupted files
      expect(result).toEqual([]);
    });
  });
});
