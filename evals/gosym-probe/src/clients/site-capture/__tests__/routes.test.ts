import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverRoutes } from '../routes.js';

const mockFetch = vi.fn();
vi.mock('undici', () => ({
  Agent: vi.fn(),
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

interface FakePage {
  evaluate: ReturnType<typeof vi.fn>;
}

function makeFetchResponse(status: number): Response {
  return { status, body: { cancel: vi.fn() } } as unknown as Response;
}

function makePage(overrides: Partial<FakePage> = {}): FakePage {
  return {
    evaluate: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('util/routes', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(makeFetchResponse(200));
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('discoverRoutes', () => {
    it('always includes the homepage even when the crawl returns nothing',
      async () => {
        const page = makePage();

        const routes = await discoverRoutes({
          previewUrl: 'https://example.com',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          page: page as any,
        });

        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({
          path: '/',
          origin: 'homepage',
          status: 'ok',
          httpStatus: 200,
        });
      });

    it('extracts same-origin hrefs, normalizes them, and tags origin', async () => {
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue([
          '/about/',
          '/contact',
          'https://example.com/shop',
          'https://other-site.com/ignored',
          'mailto:nope@example.com',
          '/about',
        ]),
      });

      const routes = await discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
      });

      const paths = routes.map((r) => r.path).sort();
      expect(paths).toEqual(['/', '/about', '/contact', '/shop']);

      const about = routes.find((r) => r.path === '/about');
      expect(about?.origin).toBe('crawl');
      expect(about?.url).toBe('https://example.com/about');
    });

    it('classifies HTTP status codes into RouteStatus', async () => {
      const statusByUrl: Record<string, number> = {
        'https://example.com': 200,
        'https://example.com/redir': 301,
        'https://example.com/missing': 404,
        'https://example.com/boom': 500,
      };
      mockFetch.mockImplementation(function (url: string) { return Promise.resolve(makeFetchResponse(statusByUrl[url] ?? 200)); },
      );
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue(['/redir', '/missing', '/boom']),
      });

      const routes = await discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
      });

      const byPath = new Map(routes.map((r) => [r.path, r]));
      expect(byPath.get('/')?.status).toBe('ok');
      expect(byPath.get('/redir')?.status).toBe('redirect');
      expect(byPath.get('/missing')?.status).toBe('notFound');
      expect(byPath.get('/boom')?.status).toBe('serverError');
    });

    it('marks routes unreachable when the fetch rejects', async () => {
      mockFetch.mockImplementation(function (url: string) {
        if (url.endsWith('/broken')) {
          return Promise.reject(new Error('DNS failure'));
        }
        return Promise.resolve(makeFetchResponse(200));
      });
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue(['/broken']),
      });

      const routes = await discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
      });

      const broken = routes.find((r) => r.path === '/broken');
      expect(broken?.status).toBe('unreachable');
      expect(broken?.note).toBe('DNS failure');
      expect(broken?.httpStatus).toBeUndefined();
    });

    it('marks routes unreachable on timeout', async () => {
      mockFetch.mockImplementation(function (_url: string, opts: RequestInit) {
        return new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('This operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue(['/slow']),
      });

      vi.useFakeTimers();
      const promise = discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
      });
      await vi.runAllTimersAsync();
      const routes = await promise;
      vi.useRealTimers();

      const slow = routes.find((r) => r.path === '/slow');
      expect(slow?.status).toBe('unreachable');
      expect(slow?.note).toBe('request timed out');
    });

    it('cancels the response body after reading the status', async () => {
      const cancelFn = vi.fn();
      mockFetch.mockResolvedValue({
        status: 200,
        body: { cancel: cancelFn },
      } as unknown as Response);
      const page = makePage();

      await discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
      });

      expect(cancelFn).toHaveBeenCalled();
    });

    it('respects the maxRoutes cap', async () => {
      const crawl = Array.from({ length: 30 }, (_, i) => `/p${i}`);
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue(crawl),
      });

      const routes = await discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
        maxRoutes: 5,
      });

      expect(routes).toHaveLength(5);
    });

    it('fires all HTTP checks concurrently', async () => {
      const callOrder: string[] = [];
      mockFetch.mockImplementation(async function (url: string) {
        callOrder.push(`start:${url}`);
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push(`end:${url}`);
        return makeFetchResponse(200);
      });
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue(['/a', '/b']),
      });

      await discoverRoutes({
        previewUrl: 'https://example.com',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page: page as any,
      });

      const starts = callOrder.filter((e) => e.startsWith('start:'));
      const firstEnd = callOrder.findIndex((e) => e.startsWith('end:'));
      expect(starts.length).toBe(3);
      expect(firstEnd).toBeGreaterThanOrEqual(starts.length);
    });
  });
});
