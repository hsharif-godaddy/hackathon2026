import { getDatabase } from '../connection.js';
import type { BlogPost } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'blog-post-repository' });

export interface CreateBlogPostParams {
  appId: string;
  campaignId?: string | null;
  slug: string;
  title: string;
  summary?: string | null;
  contentMarkdown: string; // Markdown content
  featuredImage?: string | null;
  tags?: string[] | null; // Will be JSON-stringified
  published?: boolean;
  publishedAt?: Date | null;
}

export interface UpdateBlogPostParams {
  slug?: string;
  title?: string;
  summary?: string | null;
  contentMarkdown?: string;
  featuredImage?: string | null;
  tags?: string[] | null;
  published?: boolean;
  publishedAt?: Date | null;
}

interface BlogPostRow {
  id: string;
  app_id: string;
  campaign_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  featured_image: string | null;
  tags: string | null;
  published: number; // SQLite boolean (0 or 1)
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Repository for managing blog posts
 * Handles CRUD operations for markdown blog posts
 */
export class BlogPostRepository {
  private db = getDatabase();

  /**
   * Find blog post by ID
   */
  findById(id: string): BlogPost | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM blog_posts WHERE id = ?`)
        .get(id) as BlogPostRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToPost(row);
    } catch (error) {
      logger.error('blog-post.find-by-id.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find blog post by slug
   */
  findBySlug(appId: string, slug: string): BlogPost | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM blog_posts WHERE app_id = ? AND slug = ?`)
        .get(appId, slug) as BlogPostRow | undefined;

      if (!row) {
        return null;
      }

      return this.mapRowToPost(row);
    } catch (error) {
      logger.error('blog-post.find-by-slug.error', {
        appId,
        slug,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find all blog posts for an app
   */
  findByAppId(appId: string, options?: {
    published?: boolean;
    limit?: number;
    offset?: number;
  }): BlogPost[] {
    try {
      let sql = `SELECT * FROM blog_posts WHERE app_id = ?`;
      const params: (string | number)[] = [appId];

      // Filter by published status
      if (options?.published !== undefined) {
        sql += ` AND published = ?`;
        params.push(options.published ? 1 : 0);
      }

      // Order by published_at (newest first), then created_at
      sql += ` ORDER BY COALESCE(published_at, created_at) DESC`;

      // Pagination
      if (options?.limit !== undefined) {
        sql += ` LIMIT ?`;
        params.push(options.limit);

        if (options?.offset !== undefined) {
          sql += ` OFFSET ?`;
          params.push(options.offset);
        }
      }

      const rows = this.db.prepare(sql).all(...params) as BlogPostRow[];
      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('blog-post.find-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }


  /**
   * Find published blog posts that are due to be shown (publishedAt <= now)
   * This is the primary method name per TACOROYALE-2630
   */
  findPublishedDue(appId: string, options?: {
    tag?: string;
    limit?: number;
    offset?: number;
  }): BlogPost[] {
    try {
      const now = new Date().toISOString();
      let sql = `
        SELECT * FROM blog_posts
        WHERE app_id = ?
          AND published = 1
          AND published_at <= ?
        ORDER BY published_at DESC, id DESC
      `;
      const params: (string | number)[] = [appId, now];

      // When tag filter is present, fetch all posts and filter in memory
      // to ensure correct pagination boundaries
      // When no tag filter, apply SQL-level pagination for efficiency
      if (!options?.tag && options?.limit !== undefined) {
        sql += ` LIMIT ?`;
        params.push(options.limit);

        if (options?.offset !== undefined) {
          sql += ` OFFSET ?`;
          params.push(options.offset);
        }
      }

      const rows = this.db.prepare(sql).all(...params) as BlogPostRow[];
      let posts = rows.map(row => this.mapRowToPost(row));

      // Filter by tag in application code (SQLite doesn't have native JSON array contains)
      if (options?.tag) {
        const tagToFilter = options.tag;
        posts = posts.filter(post => {
          return post.tags !== null && post.tags.includes(tagToFilter);
        });

        // Apply pagination after filtering for correct boundaries
        if (options?.limit !== undefined) {
          const offset = options?.offset || 0;
          posts = posts.slice(offset, offset + options.limit);
        }
      }

      return posts;
    } catch (error) {
      logger.error('blog-post.find-published.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Find blog posts by campaign ID
   */
  findByCampaignId(campaignId: string): BlogPost[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM blog_posts WHERE campaign_id = ? ORDER BY created_at DESC`)
        .all(campaignId) as BlogPostRow[];

      return rows.map(row => this.mapRowToPost(row));
    } catch (error) {
      logger.error('blog-post.find-by-campaign.error', {
        campaignId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Create a new blog post
   */
  create(params: CreateBlogPostParams): BlogPost {
    try {
      const id = nanoid();
      const now = new Date().toISOString();
      const tagsJson = params.tags ? JSON.stringify(params.tags) : null;

      this.db
        .prepare(
          `INSERT INTO blog_posts (
            id, app_id, campaign_id, slug, title, summary, content_markdown,
            featured_image, tags, published, published_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.appId,
          params.campaignId || null,
          params.slug,
          params.title,
          params.summary || null,
          params.contentMarkdown,
          params.featuredImage || null,
          tagsJson,
          params.published ? 1 : 0,
          params.publishedAt ? params.publishedAt.toISOString() : null,
          now,
          now
        );

      logger.info('blog-post.create.success', {
        id,
        appId: params.appId,
        slug: params.slug,
        published: params.published
      });

      const post = this.findById(id);
      if (!post) {
        throw new Error('Failed to retrieve created post');
      }

      return post;
    } catch (error) {
      logger.error('blog-post.create.error', {
        appId: params.appId,
        slug: params.slug,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update an existing blog post
   */
  update(id: string, params: UpdateBlogPostParams): BlogPost {
    try {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (params.slug !== undefined) {
        updates.push('slug = ?');
        values.push(params.slug);
      }
      if (params.title !== undefined) {
        updates.push('title = ?');
        values.push(params.title);
      }
      if (params.summary !== undefined) {
        updates.push('summary = ?');
        values.push(params.summary);
      }
      if (params.contentMarkdown !== undefined) {
        updates.push('content_markdown = ?');
        values.push(params.contentMarkdown);
      }
      if (params.featuredImage !== undefined) {
        updates.push('featured_image = ?');
        values.push(params.featuredImage);
      }
      if (params.tags !== undefined) {
        updates.push('tags = ?');
        values.push(params.tags ? JSON.stringify(params.tags) : null);
      }
      if (params.published !== undefined) {
        updates.push('published = ?');
        values.push(params.published ? 1 : 0);
      }
      if (params.publishedAt !== undefined) {
        updates.push('published_at = ?');
        values.push(params.publishedAt ? params.publishedAt.toISOString() : null);
      }

      if (updates.length === 0) {
        const post = this.findById(id);
        if (!post) {
          throw new Error('Post not found');
        }
        return post;
      }

      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);

      const sql = `UPDATE blog_posts SET ${updates.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);

      logger.info('blog-post.update.success', {
        id,
        updates: Object.keys(params)
      });

      const post = this.findById(id);
      if (!post) {
        throw new Error('Failed to retrieve updated post');
      }

      return post;
    } catch (error) {
      logger.error('blog-post.update.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete a blog post
   */
  delete(id: string): void {
    try {
      this.db.prepare(`DELETE FROM blog_posts WHERE id = ?`).run(id);

      logger.info('blog-post.delete.success', { id });
    } catch (error) {
      logger.error('blog-post.delete.error', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Count blog posts for an app
   */
  count(appId: string, published?: boolean): number {
    try {
      let sql = `SELECT COUNT(*) as count FROM blog_posts WHERE app_id = ?`;
      const params: (string | number)[] = [appId];

      if (published !== undefined) {
        sql += ` AND published = ?`;
        params.push(published ? 1 : 0);
      }

      const result = this.db.prepare(sql).get(...params) as { count: number };
      return result.count;
    } catch (error) {
      logger.error('blog-post.count.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Map database row to BlogPost object
   * Parses tags from JSON string to array
   */
  private mapRowToPost(row: BlogPostRow): BlogPost {
    let tags: string[] | null = null;
    if (row.tags) {
      try {
        tags = JSON.parse(row.tags);
      } catch (error) {
        logger.warn('blog-post.map-row.malformed-tags', {
          postId: row.id,
          tags: row.tags,
          error: error instanceof Error ? error.message : String(error)
        });
        tags = null;
      }
    }

    return {
      id: row.id,
      appId: row.app_id,
      campaignId: row.campaign_id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      contentMarkdown: row.content_markdown,
      featuredImage: row.featured_image,
      tags,
      published: row.published === 1,
      publishedAt: row.published_at ? new Date(row.published_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
