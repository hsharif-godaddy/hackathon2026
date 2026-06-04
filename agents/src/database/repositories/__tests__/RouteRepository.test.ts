/**
 * RouteRepository Test Suite
 *
 * Tests for the generic RouteRepository class covering:
 * - Generic route CRUD operations across all route types
 * - Multi-type route management (blog, landing_page, shop, events)
 * - Default route management per type
 * - Config storage and retrieval
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RouteRepository } from '../RouteRepository.js';
import type { Route } from '../../schema.js';

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

describe('RouteRepository', () => {
  let repository: RouteRepository;
  let mockDb: any;
  let mockStatement: any;

  // Test data
  const testAppId = 'app-123';
  const testRouteId = 'route-abc123';
  const now = new Date('2026-06-03T12:00:00Z');

  const mockBlogRouteRow = {
    id: testRouteId,
    app_id: testAppId,
    route_type: 'blog',
    path_prefix: 'blog',
    is_default: 1,
    created_at: now.toISOString(),
  };

  const mockLandingPageRouteRow = {
    id: 'route-landing',
    app_id: testAppId,
    route_type: 'landing_page',
    path_prefix: 'landing',
    is_default: 1,
    created_at: now.toISOString(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    };

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
      transaction: vi.fn((fn: () => void) => fn),
    };

    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    repository = new RouteRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('create - multiple route types', () => {
    it('should create blog route', () => {
      mockStatement.get.mockReturnValue(mockBlogRouteRow);

      const result = repository.create({
        appId: testAppId,
        routeType: 'blog',
        pathPrefix: 'blog',
        isDefault: true,
      });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO routes'),
      );
      expect(result.routeType).toBe('blog');
      expect(result.pathPrefix).toBe('blog');
    });

    it('should create landing_page route', () => {
      mockStatement.get.mockReturnValue(mockLandingPageRouteRow);

      const result = repository.create({
        appId: testAppId,
        routeType: 'landing_page',
        pathPrefix: 'landing',
        isDefault: true,
      });

      expect(result.routeType).toBe('landing_page');
      expect(result.pathPrefix).toBe('landing');
    });
  });

  describe('findByTypeAndPath', () => {
    it('should find blog route by type and path', () => {
      mockStatement.get.mockReturnValue(mockBlogRouteRow);

      const result = repository.findByTypeAndPath(testAppId, 'blog', 'blog');

      expect(result).toMatchObject({
        routeType: 'blog',
        pathPrefix: 'blog',
      });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_id = ? AND route_type = ? AND path_prefix = ?'),
      );
    });

    it('should find landing_page route by type and path', () => {
      mockStatement.get.mockReturnValue(mockLandingPageRouteRow);

      const result = repository.findByTypeAndPath(testAppId, 'landing_page', 'landing');

      expect(result).toMatchObject({
        routeType: 'landing_page',
        pathPrefix: 'landing',
      });
    });
  });

  describe('findByAppId - type filtering', () => {
    it('should return all routes when no type filter', () => {
      mockStatement.all.mockReturnValue([mockBlogRouteRow, mockLandingPageRouteRow]);

      const result = repository.findByAppId(testAppId);

      expect(result).toHaveLength(2);
      expect(result[0].routeType).toBe('blog');
      expect(result[1].routeType).toBe('landing_page');
    });

    it('should filter by blog type only', () => {
      mockStatement.all.mockReturnValue([mockBlogRouteRow]);

      const result = repository.findByAppId(testAppId, 'blog');

      expect(result).toHaveLength(1);
      expect(result[0].routeType).toBe('blog');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND route_type = ?'),
      );
    });

    it('should filter by landing_page type only', () => {
      mockStatement.all.mockReturnValue([mockLandingPageRouteRow]);

      const result = repository.findByAppId(testAppId, 'landing_page');

      expect(result).toHaveLength(1);
      expect(result[0].routeType).toBe('landing_page');
    });
  });

  describe('findDefault - per route type', () => {
    it('should find default blog route', () => {
      mockStatement.get.mockReturnValue(mockBlogRouteRow);

      const result = repository.findDefault(testAppId, 'blog');

      expect(result).toMatchObject({
        routeType: 'blog',
        isDefault: true,
      });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_id = ? AND route_type = ? AND is_default = 1'),
      );
    });

    it('should find default landing_page route independently', () => {
      mockStatement.get.mockReturnValue(mockLandingPageRouteRow);

      const result = repository.findDefault(testAppId, 'landing_page');

      expect(result).toMatchObject({
        routeType: 'landing_page',
        isDefault: true,
      });
    });
  });


  describe('count - per route type', () => {
    it('should count all routes', () => {
      mockStatement.get.mockReturnValue({ count: 5 });

      const result = repository.count(testAppId);

      expect(result).toBe(5);
    });

    it('should count blog routes only', () => {
      mockStatement.get.mockReturnValue({ count: 2 });

      const result = repository.count(testAppId, 'blog');

      expect(result).toBe(2);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND route_type = ?'),
      );
    });
  });

  describe('ensureDefault - per route type', () => {
    it('should create default blog route when none exist', () => {
      mockStatement.all.mockReturnValue([]); // No routes exist
      mockStatement.get.mockReturnValue(mockBlogRouteRow); // Created route

      const result = repository.ensureDefault(testAppId, 'blog');

      expect(result.routeType).toBe('blog');
      expect(result.pathPrefix).toBe('blog');
      expect(result.isDefault).toBe(true);
    });

    it('should create default landing_page route when none exist', () => {
      mockStatement.all.mockReturnValue([]);
      mockStatement.get.mockReturnValue(mockLandingPageRouteRow);

      const result = repository.ensureDefault(testAppId, 'landing_page');

      expect(result.routeType).toBe('landing_page');
      expect(result.pathPrefix).toBe('landing'); // Uses mock data path prefix
    });
  });


  describe('type isolation', () => {
    it('should not affect blog routes when updating landing_page default', () => {
      const landingPageRow = mockLandingPageRouteRow;
      mockStatement.get.mockReturnValue(landingPageRow);
      mockStatement.all.mockReturnValue([landingPageRow]);

      repository.update('route-landing', { isDefault: true });

      // Should only unset defaults for landing_page type, not blog
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_id = ? AND route_type = ? AND is_default = 1 AND id != ?'),
      );
    });

    it('should allow same pathPrefix for different route types', () => {
      // Blog route with "news" prefix
      const blogNews = { ...mockBlogRouteRow, path_prefix: 'news', id: 'blog-news' };
      mockStatement.get.mockReturnValueOnce(blogNews);

      repository.create({
        appId: testAppId,
        routeType: 'blog',
        pathPrefix: 'news',
        isDefault: true,
      });

      // Landing page route with "news" prefix (should be allowed - different type)
      const landingPageNews = { ...mockLandingPageRouteRow, path_prefix: 'news', id: 'landing_page-news' };
      mockStatement.get.mockReturnValueOnce(landingPageNews);

      const result = repository.create({
        appId: testAppId,
        routeType: 'landing_page',
        pathPrefix: 'news',
        isDefault: true,
      });

      expect(result.routeType).toBe('landing_page');
      expect(result.pathPrefix).toBe('news');
      // UNIQUE constraint is (app_id, route_type, path_prefix), so this is valid
    });
  });

  describe('delete', () => {
    it('should delete default route and promote next route to default', () => {
      const defaultRoute = { ...mockBlogRouteRow, is_default: 1 };
      const nonDefaultRoute = { ...mockBlogRouteRow, id: 'route-2', path_prefix: 'news', is_default: 0 };

      // First call: get route being deleted (is default)
      mockStatement.get.mockReturnValueOnce(defaultRoute);
      // findByAppId returns multiple routes
      mockStatement.all.mockReturnValueOnce([defaultRoute, nonDefaultRoute]);

      repository.delete(testRouteId);

      // Should call run twice (promote + delete)
      expect(mockStatement.run).toHaveBeenCalledWith('route-2');
      expect(mockStatement.run).toHaveBeenCalledWith(testRouteId);
      expect(mockStatement.run).toHaveBeenCalledTimes(2);
    });

    it('should delete non-default route without promotion', () => {
      const nonDefaultRoute = { ...mockBlogRouteRow, is_default: 0 };
      mockStatement.get.mockReturnValueOnce(nonDefaultRoute);
      mockStatement.all.mockReturnValueOnce([nonDefaultRoute]);

      repository.delete(testRouteId);

      expect(mockStatement.run).toHaveBeenCalledWith(testRouteId);
      // Should not attempt promotion
      expect(mockStatement.run).toHaveBeenCalledTimes(1);
    });

    it('should delete single default route without promotion attempt', () => {
      const defaultRoute = { ...mockBlogRouteRow, is_default: 1 };

      // First call: get route being deleted (is default)
      mockStatement.get.mockReturnValueOnce(defaultRoute);
      // findByAppId returns only one route
      mockStatement.all.mockReturnValueOnce([defaultRoute]);

      repository.delete(testRouteId);

      expect(mockStatement.run).toHaveBeenCalledWith(testRouteId);
      // Should not attempt promotion (only one route)
      expect(mockStatement.run).toHaveBeenCalledTimes(1);
    });

    it('should handle delete of non-existent route gracefully', () => {
      mockStatement.get.mockReturnValueOnce(undefined);

      repository.delete('non-existent-id');

      // Should not attempt delete
      expect(mockStatement.run).not.toHaveBeenCalled();
    });

    it('should handle database errors in delete', () => {
      const nonDefaultRoute = { ...mockBlogRouteRow, is_default: 0 };
      mockStatement.get.mockReturnValueOnce(nonDefaultRoute);
      mockStatement.all.mockReturnValueOnce([nonDefaultRoute]);
      mockStatement.run.mockImplementation(() => {
        throw new Error('Database error during delete');
      });

      expect(() => repository.delete(testRouteId)).toThrow('Database error during delete');
    });
  });
});
