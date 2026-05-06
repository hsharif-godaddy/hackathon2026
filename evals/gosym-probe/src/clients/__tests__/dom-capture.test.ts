import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPage, mockContext, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><body>test</body></html>'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
    url: vi.fn(),
    on: vi.fn(),
  };
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockPage, mockContext, mockBrowser };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

import { chromium } from 'playwright';
import {
  DOMCapture,
  AABPreviewUrlResolver,
  SetupContextResolver,
} from '../dom-capture.js';
import type { PreviewUrlResolver } from '../dom-capture.js';
import type { SetupContext } from '../../scenarios/types.js';

const BFF_URL = 'https://local.gasket.dev-godaddy.com:8443';
const PREVIEW_URL = 'https://localhost:5001';

function makeMockResolver(url = PREVIEW_URL): PreviewUrlResolver {
  return { resolve: vi.fn().mockResolvedValue(url) };
}

function mockFetch(previewUrl: string, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: vi.fn().mockResolvedValue({ previewUrl }),
      text: vi.fn().mockResolvedValue(ok ? '' : 'Unauthorized'),
    }),
  );
}

describe('DOMCapture', () => {
  let resolver: PreviewUrlResolver;
  let capture: DOMCapture;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.waitForSelector.mockResolvedValue(undefined);
    mockPage.content.mockResolvedValue('<html><body>test</body></html>');
    mockPage.screenshot.mockResolvedValue(Buffer.from('screenshot'));
    mockPage.url.mockReturnValue(PREVIEW_URL);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockBrowser.newContext.mockResolvedValue(mockContext);
    mockBrowser.close.mockResolvedValue(undefined);
    vi.mocked(chromium.launch).mockResolvedValue(
      mockBrowser as unknown as Awaited<
        ReturnType<typeof chromium.launch>
      >,
    );
    resolver = makeMockResolver();
    capture = new DOMCapture({
      resolver,
      ignoreHttpsErrors: true,
      maxRetries: 0,
    });
  });

  describe('capture(ctx)', () => {
    it('delegates URL resolution to the injected resolver', async () => {
      const ctx: SetupContext = { appId: 'app-123' };
      await capture.capture(ctx);

      expect(resolver.resolve).toHaveBeenCalledWith(ctx);
    });

    it('navigates to URL returned by resolver', async () => {
      await capture.capture({});

      expect(mockPage.goto).toHaveBeenCalledWith(
        PREVIEW_URL,
        { waitUntil: 'networkidle', timeout: 90_000 },
      );
    });

    it('returns snapshot with URL from resolver', async () => {
      const snapshot = await capture.capture({});

      expect(snapshot.url).toBe(PREVIEW_URL);
    });
  });

  describe('browser capture', () => {
    it('launches chromium browser', async () => {
      await capture.capture({});

      expect(chromium.launch).toHaveBeenCalled();
    });

    it('creates context with ignoreHTTPSErrors=true', async () => {
      await capture.capture({});

      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        ignoreHTTPSErrors: true,
      });
    });

    it('creates context with ignoreHTTPSErrors=false when configured',
      async () => {
        const c = new DOMCapture({
          resolver: makeMockResolver(),
          ignoreHttpsErrors: false,
        });
        await c.capture({});

        expect(mockBrowser.newContext).toHaveBeenCalledWith({
          ignoreHTTPSErrors: false,
        });
      },
    );

    it('returns snapshot with html content', async () => {
      const snapshot = await capture.capture({});

      expect(snapshot.html).toBe('<html><body>test</body></html>');
    });

    it('returns snapshot with screenshot buffer', async () => {
      const snapshot = await capture.capture({});

      expect(snapshot.screenshot).toBeInstanceOf(Buffer);
    });

    it('returns snapshot with ISO timestamp', async () => {
      const before = new Date().toISOString();
      const snapshot = await capture.capture({});
      const after = new Date().toISOString();

      expect(snapshot.timestamp >= before).toBe(true);
      expect(snapshot.timestamp <= after).toBe(true);
    });

    it('closes browser after successful capture', async () => {
      await capture.capture({});

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('closes browser even when page.goto throws', async () => {
      mockPage.goto.mockRejectedValue(
        new Error('net::ERR_CONNECTION_REFUSED'),
      );

      await expect(capture.capture({})).rejects.toThrow(
        'net::ERR_CONNECTION_REFUSED',
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('waits for readySelector after navigation', async () => {
      await capture.capture({});

      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        '#app > *',
        { timeout: 90_000 },
      );
    });

    it('uses custom readySelector when configured', async () => {
      const c = new DOMCapture({
        resolver: makeMockResolver(),
        ignoreHttpsErrors: true,
        readySelector: '.app-root',
      });

      await c.capture({});

      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        '.app-root',
        { timeout: 90_000 },
      );
    });

    it('uses custom readyTimeoutMs when configured', async () => {
      const c = new DOMCapture({
        resolver: makeMockResolver(),
        ignoreHttpsErrors: true,
        readyTimeoutMs: 30_000,
      });

      await c.capture({});

      expect(mockPage.goto).toHaveBeenCalledWith(
        PREVIEW_URL,
        { waitUntil: 'networkidle', timeout: 30_000 },
      );
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        '#app > *',
        { timeout: 30_000 },
      );
    });

    it('throws when goto times out', async () => {
      mockPage.goto.mockRejectedValue(
        new Error('Timeout 15000ms exceeded'),
      );

      await expect(capture.capture({})).rejects.toThrow(
        'Timeout 15000ms exceeded',
      );
    });

    it('throws when readySelector times out', async () => {
      mockPage.waitForSelector.mockRejectedValue(
        new Error('Timeout 15000ms exceeded'),
      );

      await expect(capture.capture({})).rejects.toThrow(
        'Timeout 15000ms exceeded',
      );
    });
  });

  describe('redirect detection', () => {
    it('warns when final URL differs from initial URL', async () => {
      const redirectedUrl =
        'https://local.gasket.dev-godaddy.com:8443' +
        '/develop/app-123';
      mockPage.url.mockReturnValue(redirectedUrl);
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await capture.capture({});

      expect(warnSpy).toHaveBeenCalledWith(
        'DOMCapture: redirect detected',
        { expected: PREVIEW_URL, actual: redirectedUrl },
      );
    });

    it('does not warn when final URL matches initial URL', async () => {
      mockPage.url.mockReturnValue(PREVIEW_URL);
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await capture.capture({});

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn when browser appends trailing slash', async () => {
      const urlWithSlash = PREVIEW_URL + '/';
      mockPage.url.mockReturnValue(urlWithSlash);
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await capture.capture({});

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn when resolver URL has slash browser drops it',
      async () => {
        const resolverUrl = PREVIEW_URL + '/';
        resolver = makeMockResolver(resolverUrl);
        capture = new DOMCapture({
          resolver,
          ignoreHttpsErrors: true,
        });
        mockPage.url.mockReturnValue(PREVIEW_URL);
        const warnSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        await capture.capture({});

        expect(warnSpy).not.toHaveBeenCalled();
      },
    );

    it('warns on genuine redirect to different host', async () => {
      const genuineRedirect = 'https://other.example.com/login';
      mockPage.url.mockReturnValue(genuineRedirect);
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await capture.capture({});

      expect(warnSpy).toHaveBeenCalledWith(
        'DOMCapture: redirect detected',
        { expected: PREVIEW_URL, actual: genuineRedirect },
      );
    });
  });

  describe('console log capture', () => {
    function fireConsole(
      messages: Array<{ type: string; text: string }>,
    ): void {
      const call = mockPage.on.mock.calls.find(
        ([e]) => e === 'console',
      );
      const handler = call?.[1] as
        | ((msg: { type(): string; text(): string }) => void)
        | undefined;
      for (const msg of messages) {
        handler?.({ type: () => msg.type, text: () => msg.text });
      }
    }

    it('returns empty consoleLogs when no messages fired', async () => {
      const snapshot = await capture.capture({});

      expect(snapshot.consoleLogs).toEqual([]);
    });

    it('captures console messages with type and text', async () => {
      mockPage.goto.mockImplementation(async () => {
        fireConsole([{ type: 'error', text: 'Something failed' }]);
      });

      const snapshot = await capture.capture({});

      expect(snapshot.consoleLogs).toEqual([
        { type: 'error', text: 'Something failed' },
      ]);
    });

    it('captures multiple console messages in order', async () => {
      mockPage.goto.mockImplementation(async () => {
        fireConsole([
          { type: 'log', text: 'first' },
          { type: 'warn', text: 'second' },
          { type: 'error', text: 'third' },
        ]);
      });

      const snapshot = await capture.capture({});

      expect(snapshot.consoleLogs).toEqual([
        { type: 'log', text: 'first' },
        { type: 'warn', text: 'second' },
        { type: 'error', text: 'third' },
      ]);
    });
  });

  describe('retry logic', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it(
      'retries on waitForSelector timeout and succeeds on second attempt',
      async () => {
        const c = new DOMCapture({
          resolver: makeMockResolver(),
          ignoreHttpsErrors: true,
          maxRetries: 1,
        });
        mockPage.waitForSelector
          .mockRejectedValueOnce(new Error('Timeout'))
          .mockResolvedValueOnce(undefined);

        const p = c.capture({});
        await vi.runAllTimersAsync();
        const snapshot = await p;

        expect(snapshot).toBeDefined();
        expect(chromium.launch).toHaveBeenCalledTimes(2);
      },
    );

    it(
      'retries on page.goto failure and succeeds on second attempt',
      async () => {
        const c = new DOMCapture({
          resolver: makeMockResolver(),
          ignoreHttpsErrors: true,
          maxRetries: 1,
        });
        mockPage.goto
          .mockRejectedValueOnce(
            new Error('net::ERR_CONNECTION_REFUSED'),
          )
          .mockResolvedValueOnce(undefined);

        const p = c.capture({});
        await vi.runAllTimersAsync();
        const snapshot = await p;

        expect(snapshot).toBeDefined();
        expect(chromium.launch).toHaveBeenCalledTimes(2);
      },
    );

    it('throws after exhausting all retries', async () => {
      const c = new DOMCapture({
        resolver: makeMockResolver(),
        ignoreHttpsErrors: true,
        maxRetries: 1,
      });
      mockPage.goto.mockRejectedValue(new Error('net::ERR_FAILED'));

      const p = c.capture({});
      const assertion = expect(p).rejects.toThrow('net::ERR_FAILED');
      await vi.runAllTimersAsync();
      await assertion;

      expect(chromium.launch).toHaveBeenCalledTimes(2);
    });

    it('maxRetries: 0 disables retries and throws on first failure',
      async () => {
        const c = new DOMCapture({
          resolver: makeMockResolver(),
          ignoreHttpsErrors: true,
          maxRetries: 0,
        });
        mockPage.goto.mockRejectedValue(new Error('net::ERR_FAILED'));

        await expect(c.capture({})).rejects.toThrow('net::ERR_FAILED');
        expect(chromium.launch).toHaveBeenCalledTimes(1);
      },
    );

    it('defaults to 0 retries when maxRetries is not configured',
      async () => {
        const c = new DOMCapture({
          resolver: makeMockResolver(),
          ignoreHttpsErrors: true,
        });
        mockPage.goto.mockRejectedValue(new Error('always fails'));

        await expect(c.capture({})).rejects.toThrow('always fails');

        expect(chromium.launch).toHaveBeenCalledTimes(1);
      },
    );

    it('logs warning on non-final failed attempts', async () => {
      const c = new DOMCapture({
        resolver: makeMockResolver(),
        ignoreHttpsErrors: true,
        maxRetries: 1,
      });
      const error = new Error('temporary failure');
      mockPage.goto
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(undefined);

      const p = c.capture({});
      await vi.runAllTimersAsync();
      await p;

      expect(warnSpy).toHaveBeenCalledWith(
        'DOMCapture: attempt failed, retrying',
        { attempt: 1 },
        error,
      );
    });

    it('closes browser after each attempt', async () => {
      const c = new DOMCapture({
        resolver: makeMockResolver(),
        ignoreHttpsErrors: true,
        maxRetries: 1,
      });
      mockPage.goto
        .mockRejectedValueOnce(new Error('first attempt fails'))
        .mockResolvedValueOnce(undefined);

      const p = c.capture({});
      await vi.runAllTimersAsync();
      await p;

      expect(mockBrowser.close).toHaveBeenCalledTimes(2);
    });
  });
});

describe('AABPreviewUrlResolver', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches preview URL from /api/servers/{appId}', async () => {
    mockFetch(PREVIEW_URL);
    const r = new AABPreviewUrlResolver({
      bffUrl: BFF_URL,
      ignoreHttpsErrors: false,
    });

    const url = await r.resolve({ appId: 'app-123' });

    expect(url).toBe(PREVIEW_URL);
    expect(fetch).toHaveBeenCalledWith(
      `${BFF_URL}/api/servers/app-123`,
    );
  });

  it('throws when server API returns non-ok response', async () => {
    mockFetch(PREVIEW_URL, false);
    const r = new AABPreviewUrlResolver({
      bffUrl: BFF_URL,
      ignoreHttpsErrors: false,
    });

    await expect(r.resolve({ appId: 'app-123' })).rejects.toThrow(
      'HTTP 500 Unauthorized',
    );
  });

  it('bypasses TLS for fetch when ignoreHttpsErrors is true',
    async () => {
      mockFetch(PREVIEW_URL);
      const r = new AABPreviewUrlResolver({
        bffUrl: BFF_URL,
        ignoreHttpsErrors: true,
      });

      await expect(
        r.resolve({ appId: 'app-123' }),
      ).resolves.toBe(PREVIEW_URL);
    },
  );

  it(
    'does not modify NODE_TLS_REJECT_UNAUTHORIZED during resolve()',
    async () => {
      const sentinel = '1';
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = sentinel;
      let envDuringFetch: string | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => {
          envDuringFetch =
            process.env.NODE_TLS_REJECT_UNAUTHORIZED;
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              previewUrl: PREVIEW_URL,
            }),
            text: vi.fn().mockResolvedValue(''),
          };
        }),
      );
      const r = new AABPreviewUrlResolver({
        bffUrl: BFF_URL,
        ignoreHttpsErrors: true,
      });

      await r.resolve({ appId: 'app-123' });

      expect(envDuringFetch).toBe(sentinel);
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    },
  );
});

describe('SetupContextResolver', () => {
  it('returns previewUrl from SetupContext', async () => {
    const r = new SetupContextResolver();
    const url = await r.resolve({
      previewUrl: 'http://localhost:5100',
    });
    expect(url).toBe('http://localhost:5100');
  });

  it('throws when previewUrl is missing from SetupContext', async () => {
    const r = new SetupContextResolver();
    await expect(r.resolve({})).rejects.toThrow(
      /missing previewUrl/i,
    );
  });

  it('throws when previewUrl is undefined', async () => {
    const r = new SetupContextResolver();
    await expect(
      r.resolve({ previewUrl: undefined }),
    ).rejects.toThrow(/missing previewUrl/i);
  });
});
