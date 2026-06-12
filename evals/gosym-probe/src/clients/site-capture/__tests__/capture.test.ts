import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { DiscoveredRoute } from '../types.js';

const {
  mockDiscoverRoutes,
  mockCaptureTiles,
  mockCaptureRenderedSignals,
  mockIsRouteEmpty,
  mockDismissCookieConsent,
  makePage,
} = vi.hoisted(() => {
  const makePage = () => ({
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  });
  return {
    mockDiscoverRoutes: vi.fn(),
    mockCaptureTiles: vi.fn().mockResolvedValue({ tiles: [] }),
    mockCaptureRenderedSignals: vi.fn().mockResolvedValue({}),
    mockIsRouteEmpty: vi.fn().mockReturnValue(false),
    mockDismissCookieConsent: vi.fn().mockResolvedValue(undefined),
    makePage,
  };
});

vi.mock('../routes.js', () => ({ discoverRoutes: mockDiscoverRoutes }));
vi.mock('../tiles.js', () => ({
  captureTiles: mockCaptureTiles,
  slugifyPath: (p: string) => (p === '/' ? 'home' : p.replace(/\//g, '-')),
}));
vi.mock('../render-check.js', () => ({
  captureRenderedSignals: mockCaptureRenderedSignals,
  isRouteEmpty: mockIsRouteEmpty,
}));
vi.mock('../cookie-dismiss.js', () => ({
  dismissCookieConsent: mockDismissCookieConsent,
}));

import { captureRoutes } from '../capture.js';

const HOME_ROUTE: DiscoveredRoute = {
  path: '/',
  url: 'https://preview.local/',
  origin: 'homepage',
  status: 'ok',
};

describe('captureRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverRoutes.mockResolvedValue([HOME_ROUTE]);
    mockCaptureTiles.mockResolvedValue({ tiles: [] });
    mockCaptureRenderedSignals.mockResolvedValue({});
    mockIsRouteEmpty.mockReturnValue(false);
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm('/tmp/capture-routes-test', { recursive: true, force: true });
  });

  function makeContext(pages: ReturnType<typeof makePage>[]) {
    let i = 0;
    return {
      newPage: vi.fn().mockImplementation(() => Promise.resolve(pages[i++])),
    };
  }

  it('captures both viewports by default (one newPage per viewport)', async () => {
    const pages = [makePage(), makePage()];
    const context = makeContext(pages);

    await captureRoutes({
      previewUrl: 'https://preview.local/',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: context as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      homepagePage: makePage() as any,
      outputDir: '/tmp/capture-routes-test',
    });

    // One route × two viewports = two pages opened.
    expect(context.newPage).toHaveBeenCalledTimes(2);
  });

  it('captures only the configured viewports (trimming halves navigations)', async () => {
    const pages = [makePage()];
    const context = makeContext(pages);

    await captureRoutes({
      previewUrl: 'https://preview.local/',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: context as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      homepagePage: makePage() as any,
      outputDir: '/tmp/capture-routes-test',
      viewports: ['mobile'],
    });

    expect(context.newPage).toHaveBeenCalledTimes(1);
  });

  it('honors custom goto and app-ready timeouts', async () => {
    const page = makePage();
    const context = makeContext([page]);

    await captureRoutes({
      previewUrl: 'https://preview.local/',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: context as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      homepagePage: makePage() as any,
      outputDir: '/tmp/capture-routes-test',
      viewports: ['mobile'],
      gotoTimeoutMs: 11_000,
      appReadyTimeoutMs: 6_000,
    });

    expect(page.goto).toHaveBeenCalledWith(
      'https://preview.local/',
      expect.objectContaining({ timeout: 11_000 }),
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 6_000 }),
    );
  });

  it('falls back to default timeouts when unset', async () => {
    const page = makePage();
    const context = makeContext([page]);

    await captureRoutes({
      previewUrl: 'https://preview.local/',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      context: context as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      homepagePage: makePage() as any,
      outputDir: '/tmp/capture-routes-test',
      viewports: ['mobile'],
    });

    expect(page.goto).toHaveBeenCalledWith(
      'https://preview.local/',
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });
});
