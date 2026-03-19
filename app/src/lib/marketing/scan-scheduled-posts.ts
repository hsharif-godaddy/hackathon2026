import fs from 'fs/promises';
import matter from 'gray-matter';
import path from 'path';

import { getAppPath } from '@/lib/dev-environment/utils/app-paths';
import { logger } from '@/lib/request-context';
import { ScheduledPost } from '@/types/marketing';

// Simple in-memory cache with TTL
interface CacheEntry {
  data: ScheduledPost[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000; // 30 seconds

// Promise lock to prevent concurrent scans for the same appId
const scanLocks = new Map<string, Promise<ScheduledPost[]>>();

/**
 * Get the blog content directory path for an app
 * Includes input validation as defense-in-depth security measure
 */
function getBlogPath(appId: string): string {
  // Validate appId contains only safe characters (defense-in-depth)
  // Even though appId comes from authenticated routes, validate to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(appId)) {
    throw new Error(`Invalid appId format: ${appId}`);
  }
  return path.join(getAppPath(appId), 'src/content/blog');
}

/**
 * Get the full file path for a blog post
 * blogPath is validated via getBlogPath(), filename comes from fs.readdir()
 */
function getBlogFilePath(blogPath: string, filename: string): string {
  return path.join(blogPath, filename);
}

/**
 * Check if blog is installed by looking for the blog directory
 */
async function isBlogInstalled(appId: string): Promise<boolean> {
  try {
    const blogPath = getBlogPath(appId);
    await fs.access(blogPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a date string is valid and parseable
 */
function isValidDate(dateString: unknown): dateString is string {
  if (typeof dateString !== 'string') {return false;}
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Parse a single markdown file and extract post metadata
 */
async function parseMarkdownFile(
  filePath: string,
  filename: string,
  appId: string
): Promise<ScheduledPost | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data } = matter(content);

    // Validate required fields
    if (!data.publishedAt) {
      logger.debug('marketing.scan_posts.missing_date', { appId, filename });
      return null;
    }

    if (!isValidDate(data.publishedAt)) {
      logger.warn('marketing.scan_posts.invalid_date', {
        appId,
        filename,
        publishedAt: data.publishedAt
      });
      return null;
    }

    const publishedAt = new Date(data.publishedAt);
    const now = new Date();
    const status = publishedAt > now ? 'scheduled' : 'published';

    return {
      slug: filename.replace(/\.(md|mdx)$/, ''),
      title: data.title || 'Untitled',
      publishedAt: data.publishedAt,
      status,
      type: 'blog'
    };
  } catch (error) {
    logger.warn('marketing.scan_posts.parse_error', {
      appId,
      filename,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

/**
 * Scan all blog posts from the blog content directory
 * Returns both scheduled (future) and published (past) posts
 * to show content history and demonstrate value to users
 */
export async function scanScheduledPosts(appId: string): Promise<ScheduledPost[]> {
  try {
    // Check cache first
    const cached = cache.get(appId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.debug('marketing.scan_posts.cache_hit', { appId });
      return cached.data;
    }

    // Check if there's already a scan in progress for this appId
    const existingLock = scanLocks.get(appId);
    if (existingLock) {
      logger.debug('marketing.scan_posts.awaiting_existing_scan', { appId });
      return await existingLock;
    }

    // Create a new scan promise and store it in the lock
    const scanPromise = performScan(appId);
    scanLocks.set(appId, scanPromise);

    try {
      const result = await scanPromise;
      return result;
    } finally {
      // Remove the lock when done (success or failure)
      scanLocks.delete(appId);
    }
  } catch (error) {
    logger.error('marketing.scan_posts.error', {
      appId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return [];
  }
}

/**
 * Internal function that performs the actual scan
 * Separated to enable promise-based locking
 */
async function performScan(appId: string): Promise<ScheduledPost[]> {
    // Check if blog is installed
    const blogInstalled = await isBlogInstalled(appId);
    if (!blogInstalled) {
      logger.debug('marketing.scan_posts.blog_not_installed', { appId });
      return [];
    }

    // Path to blog content directory
    const blogPath = getBlogPath(appId);

    // Read all files in the blog directory
    const files = await fs.readdir(blogPath);
    const markdownFiles = files.filter(file => {
      const isMarkdown = file.endsWith('.md') || file.endsWith('.mdx');
      const isNotReadme = !file.toLowerCase().includes('readme');
      return isMarkdown && isNotReadme;
    });

    logger.debug('marketing.scan_posts.scanning', {
      appId,
      fileCount: markdownFiles.length
    });

    // Parse all files in parallel
    const parsePromises = markdownFiles.map(file =>
      parseMarkdownFile(getBlogFilePath(blogPath, file), file, appId)
    );

    const parsedPosts = await Promise.all(parsePromises);

    // Filter out nulls and keep all posts (past and future)
    const allPosts = parsedPosts
      .filter((post): post is ScheduledPost => post !== null)
      .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

    const scheduledCount = allPosts.filter(p => p.status === 'scheduled').length;
    const publishedCount = allPosts.filter(p => p.status === 'published').length;

    logger.info('marketing.scan_posts.success', {
      appId,
      totalFiles: markdownFiles.length,
      totalPosts: allPosts.length,
      scheduledCount,
      publishedCount
    });

    // Update cache
    cache.set(appId, {
      data: allPosts,
      timestamp: Date.now()
    });

    return allPosts;
}

/**
 * Clear the cache for a specific app or all apps
 * Call this when blog posts are created/updated/deleted
 */
export function clearScheduledPostsCache(appId?: string): void {
  if (appId) {
    cache.delete(appId);
    logger.debug('marketing.scan_posts.cache_cleared', { appId });
  } else {
    cache.clear();
    logger.debug('marketing.scan_posts.cache_cleared_all');
  }
}

/**
 * Get scheduled posts for a specific month
 * Uses cached data from scanScheduledPosts
 */
export async function getScheduledPostsForMonth(
  appId: string,
  month: Date
): Promise<ScheduledPost[]> {
  const allScheduledPosts = await scanScheduledPosts(appId);

  // Filter posts for the specified month
  const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);

  const filtered = allScheduledPosts.filter(post => {
    const postDate = new Date(post.publishedAt);
    return postDate >= startOfMonth && postDate <= endOfMonth;
  });

  logger.debug('marketing.scan_posts.month_filter', {
    appId,
    month: month.toISOString(),
    totalScheduled: allScheduledPosts.length,
    monthFiltered: filtered.length
  });

  return filtered;
}
