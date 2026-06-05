import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';
import type { BlogPost } from '../../../database/schema.js';

const APP_ID = 'abc1234567'; // matches /^[a-z0-9]{10}$/ so ownership middleware accepts it
const OTHER_APP_ID = 'zyx9876543';
const SITE_ID = APP_ID; // single-tenant agent: siteId == appId

// Mock repositories
const mockBlogPostRepo = {
  findById: vi.fn(),
  findBySlug: vi.fn(),
  findByAppId: vi.fn(),
  findPublishedDue: vi.fn(),
  findByCampaignId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};

const mockAppRepo = {
  findById: vi.fn(),
};

vi.mock('../../../database/index.js', () => ({
  BlogPostRepository: vi.fn(function () { return mockBlogPostRepo; }),
  AppRepository: vi.fn(function () { return mockAppRepo; }),
}));

function buildApp(router: express.Router, siteId: string = SITE_ID): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).agentContext = {
      siteId,
      customerId: 'cust-1',
      sessionId: 'sess-1',
      authType: 'basic',
      product: 'AiroAppBuilder',
    } as unknown as AuthenticatedRequest['agentContext'];
    next();
  });
  app.use('/', router);
  return app;
}

const mockPost: BlogPost = {
  id: 'post123',
  appId: APP_ID,
  campaignId: null,
  slug: 'test-post',
  title: 'Test Post',
  summary: 'A test summary',
  contentMarkdown: '# Test Content',
  featuredImage: null,
  tags: ['test', 'blog'],
  published: false,
  publishedAt: null,
  createdAt: new Date('2026-06-04T10:00:00Z'),
  updatedAt: new Date('2026-06-04T10:00:00Z'),
};

describe('blog-posts routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: app exists
    mockAppRepo.findById.mockReturnValue({ id: APP_ID, name: 'Test App', path: '/test' });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('POST /apps/:id/blog/posts', () => {
    it('creates a blog post with valid data', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findBySlug.mockReturnValue(null); // No duplicate
      mockBlogPostRepo.create.mockReturnValue(mockPost);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Test Content',
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 'post123',
        slug: 'test-post',
        title: 'Test Post',
      });
      expect(mockBlogPostRepo.create).toHaveBeenCalledWith({
        appId: APP_ID,
        slug: 'test-post',
        title: 'Test Post',
        contentMarkdown: '# Test Content',
        summary: null,
        featuredImage: null,
        tags: null,
        published: false,
        publishedAt: null,
        campaignId: null,
      });
    });

    it('creates a blog post with all optional fields', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findBySlug.mockReturnValue(null);
      mockBlogPostRepo.create.mockReturnValue({
        ...mockPost,
        summary: 'Summary',
        featuredImage: 'https://example.com/image.jpg',
        tags: ['tag1', 'tag2'],
        published: true,
        publishedAt: new Date('2026-06-04T12:00:00Z'),
        campaignId: 'campaign123',
      });

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'full-post',
          title: 'Full Post',
          contentMarkdown: '# Full Content',
          summary: 'Summary',
          featuredImage: 'https://example.com/image.jpg',
          tags: ['tag1', 'tag2'],
          published: true,
          publishedAt: '2026-06-04T12:00:00Z',
          campaignId: 'campaign123',
        });

      expect(res.status).toBe(201);
      expect(mockBlogPostRepo.create).toHaveBeenCalledWith({
        appId: APP_ID,
        slug: 'full-post',
        title: 'Full Post',
        contentMarkdown: '# Full Content',
        summary: 'Summary',
        featuredImage: 'https://example.com/image.jpg',
        tags: ['tag1', 'tag2'],
        published: true,
        publishedAt: new Date('2026-06-04T12:00:00Z'),
        campaignId: 'campaign123',
      });
    });

    it('returns 400 for missing slug', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          title: 'Test Post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('slug');
    });

    it('returns 400 for missing title', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('title');
    });

    it('returns 400 for missing contentMarkdown', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('contentMarkdown');
    });


    it('returns 400 for invalid publishedAt', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
          publishedAt: 'invalid-date',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('publishedAt');
    });

    it('returns 404 when app not found', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockAppRepo.findById.mockReturnValue(null);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('App not found');
    });

    it('returns 403 when accessing different app', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter, APP_ID);

      mockAppRepo.findById.mockReturnValue({ id: OTHER_APP_ID, name: 'Other App' });

      const res = await request(app)
        .post(`/apps/${OTHER_APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied');
    });

    it('returns 400 when published is true but publishedAt is missing', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
          published: true,
          // publishedAt missing
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('publishedAt is required');
    });

    it('returns 400 when tags is not an array', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
          tags: 'marketing', // String instead of array
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('tags must be an array');
    });

    it('returns 400 when published is not a boolean', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
          published: 'false', // String instead of boolean
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('published must be a boolean');
    });

    it('returns 409 for duplicate slug', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findBySlug.mockReturnValue(mockPost); // Duplicate exists

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Another Post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Slug already exists');
    });
  });

  describe('GET /apps/:id/blog/posts', () => {
    it('lists all posts for an app', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findByAppId.mockReturnValue([mockPost]);
      mockBlogPostRepo.count.mockReturnValue(1);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.posts[0]).toMatchObject({
        id: 'post123',
        slug: 'test-post',
      });
      expect(res.body.count).toBe(1);
      expect(res.body.totalCount).toBe(1);
      expect(res.body.hasMore).toBe(false);
    });

    it('filters by published status', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findByAppId.mockReturnValue([mockPost]);
      mockBlogPostRepo.count.mockReturnValue(1);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?published=true`);

      expect(res.status).toBe(200);
      expect(mockBlogPostRepo.findByAppId).toHaveBeenCalledWith(APP_ID, {
        published: true,
        limit: 51,
        offset: 0,
      });
    });

    it('filters by tag', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const taggedPost = { ...mockPost, tags: ['test', 'other'] };
      mockBlogPostRepo.findByAppId.mockReturnValue([taggedPost]);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?tag=test`);

      expect(res.status).toBe(200);
      expect(mockBlogPostRepo.findByAppId).toHaveBeenCalledWith(APP_ID, {
        published: undefined,
      });
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.totalCount).toBe(1);
    });

    it('honors published filter with tag query', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const publishedTagged = { ...mockPost, id: 'post1', published: true, tags: ['test'] };
      const unpublishedTagged = { ...mockPost, id: 'post2', published: false, tags: ['test'] };

      // Mock returns only unpublished posts
      mockBlogPostRepo.findByAppId.mockReturnValue([unpublishedTagged]);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?tag=test&published=false`);

      expect(res.status).toBe(200);
      expect(mockBlogPostRepo.findByAppId).toHaveBeenCalledWith(APP_ID, {
        published: false, // Should honor the published filter
      });
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.posts[0].id).toBe('post2');
    });

    it('calculates totalCount correctly for tag-filtered results', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const post1 = { ...mockPost, id: 'post1', tags: ['test', 'other'] };
      const post2 = { ...mockPost, id: 'post2', tags: ['test'] };
      const post3 = { ...mockPost, id: 'post3', tags: ['other'] }; // No 'test' tag

      mockBlogPostRepo.findByAppId.mockReturnValue([post1, post2, post3]);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?tag=test`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(2); // Only posts with 'test' tag
      expect(res.body.totalCount).toBe(2); // Should reflect filtered count, not all posts
    });

    it('supports pagination', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findByAppId.mockReturnValue([mockPost]);
      mockBlogPostRepo.count.mockReturnValue(100);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?limit=10&offset=20`);

      expect(res.status).toBe(200);
      expect(mockBlogPostRepo.findByAppId).toHaveBeenCalledWith(APP_ID, {
        published: undefined,
        limit: 11, // +1 for hasMore check
        offset: 20,
      });
      expect(res.body.limit).toBe(10);
      expect(res.body.offset).toBe(20);
    });

    it('indicates hasMore when more results exist', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      // Return 11 posts when limit is 10
      const posts = Array(11).fill(mockPost);
      mockBlogPostRepo.findByAppId.mockReturnValue(posts);
      mockBlogPostRepo.count.mockReturnValue(100);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?limit=10`);

      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(10); // Extra one removed
      expect(res.body.hasMore).toBe(true);
    });

    it('returns 400 for invalid limit', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?limit=200`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('limit');
    });

    it('returns 400 for invalid offset', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?offset=-1`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('offset');
    });

    it('returns 400 for limit with trailing garbage', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?limit=10abc`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('limit must be a positive integer');
    });

    it('returns 400 for offset with trailing garbage', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts?offset=5xyz`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('offset must be a positive integer');
    });
  });

  describe('GET /apps/:id/blog/posts/:postId', () => {
    it('returns a single post', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts/post123`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'post123',
        slug: 'test-post',
        title: 'Test Post',
      });
    });

    it('returns 404 when post not found', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(null);

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts/nonexistent`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Post not found');
    });

    it('returns 403 when post belongs to different app', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue({
        ...mockPost,
        appId: OTHER_APP_ID,
      });

      const res = await request(app).get(`/apps/${APP_ID}/blog/posts/post123`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('does not belong');
    });
  });

  describe('PUT /apps/:id/blog/posts/:postId', () => {
    it('updates a post with valid data', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);
      mockBlogPostRepo.update.mockReturnValue({
        ...mockPost,
        title: 'Updated Title',
      });

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          title: 'Updated Title',
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Title');
      expect(mockBlogPostRepo.update).toHaveBeenCalledWith('post123', {
        slug: undefined,
        title: 'Updated Title',
        contentMarkdown: undefined,
        summary: undefined,
        featuredImage: undefined,
        tags: undefined,
        published: undefined,
        publishedAt: undefined,
      });
    });

    it('updates slug and checks for duplicates', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);
      mockBlogPostRepo.findBySlug.mockReturnValue(null); // No duplicate
      mockBlogPostRepo.update.mockReturnValue({
        ...mockPost,
        slug: 'new-slug',
      });

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          slug: 'new-slug',
        });

      expect(res.status).toBe(200);
      expect(mockBlogPostRepo.findBySlug).toHaveBeenCalledWith(APP_ID, 'new-slug');
    });


    it('returns 404 when post not found', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(null);

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/nonexistent`)
        .send({
          title: 'Updated Title',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Post not found');
    });

    it('returns 403 when post belongs to different app', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue({
        ...mockPost,
        appId: OTHER_APP_ID,
      });

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          title: 'Updated Title',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('does not belong');
    });

    it('returns 400 when no fields provided', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('At least one field');
    });

    it('updates all fields at once', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);
      mockBlogPostRepo.findBySlug.mockReturnValue(null);
      mockBlogPostRepo.update.mockReturnValue({
        ...mockPost,
        slug: 'updated-slug',
        title: 'Updated Title',
        contentMarkdown: '# Updated Content',
        summary: 'Updated summary',
        published: true,
      });

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          slug: 'updated-slug',
          title: 'Updated Title',
          contentMarkdown: '# Updated Content',
          summary: 'Updated summary',
          published: true,
          publishedAt: '2026-06-04T15:00:00Z',
        });

      expect(res.status).toBe(200);
      expect(mockBlogPostRepo.update).toHaveBeenCalled();
    });

    it('returns 400 when setting published to true without publishedAt', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      const unpublishedPost = { ...mockPost, published: false, publishedAt: null };
      mockBlogPostRepo.findById.mockReturnValue(unpublishedPost);

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          published: true,
          // publishedAt not provided
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('publishedAt is required');
    });

    it('returns 400 when tags is not an array', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          tags: 'marketing', // String instead of array
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('tags must be an array');
    });

    it('returns 400 when published is not a boolean', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          published: 'true', // String instead of boolean
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('published must be a boolean');
    });

    it('returns 409 for duplicate slug on update', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);
      mockBlogPostRepo.findBySlug.mockReturnValue({ ...mockPost, id: 'other-post' }); // Different post with same slug

      const res = await request(app)
        .put(`/apps/${APP_ID}/blog/posts/post123`)
        .send({
          slug: 'duplicate-slug',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Slug already exists');
    });
  });

  describe('DELETE /apps/:id/blog/posts/:postId', () => {
    it('deletes a post', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(mockPost);
      mockBlogPostRepo.delete.mockReturnValue(undefined);

      const res = await request(app).delete(`/apps/${APP_ID}/blog/posts/post123`);

      expect(res.status).toBe(204);
      expect(mockBlogPostRepo.delete).toHaveBeenCalledWith('post123');
    });

    it('returns 404 when post not found', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue(null);

      const res = await request(app).delete(`/apps/${APP_ID}/blog/posts/nonexistent`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Post not found');
    });

    it('returns 403 when post belongs to different app', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findById.mockReturnValue({
        ...mockPost,
        appId: OTHER_APP_ID,
      });

      const res = await request(app).delete(`/apps/${APP_ID}/blog/posts/post123`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('does not belong');
    });
  });

  describe('Error handling', () => {
    it('handles database errors gracefully', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findBySlug.mockImplementation(() => {
        throw new Error('Database error');
      });

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });

    it('handles UNIQUE constraint violations', async () => {
      const { default: blogPostsRouter } = await import('../blog-posts.js');
      const app = buildApp(blogPostsRouter);

      mockBlogPostRepo.findBySlug.mockReturnValue(null);
      mockBlogPostRepo.create.mockImplementation(() => {
        throw new Error('UNIQUE constraint failed: blog_posts.slug');
      });

      const res = await request(app)
        .post(`/apps/${APP_ID}/blog/posts`)
        .send({
          slug: 'test-post',
          title: 'Test Post',
          contentMarkdown: '# Content',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Duplicate entry');
      expect(res.body.details).toBe('A resource with this unique identifier already exists');
    });
  });
});
