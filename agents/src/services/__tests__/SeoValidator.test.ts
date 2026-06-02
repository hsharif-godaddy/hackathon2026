import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validatePublishedSeo } from '../SeoValidator.js';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

const FULL_HTML = `<!doctype html>
<html>
<head>
<title>My Page</title>
<meta name="description" content="A good description">
<meta property="og:title" content="My Page">
<meta property="og:description" content="A good description">
<meta property="og:image" content="https://example.com/img.png">
<meta property="og:url" content="https://example.com/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://example.com/img.png">
<link rel="canonical" href="https://example.com/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script>
</head>
<body>
<h1>Hello</h1>
</body>
</html>`;

function mockFetchReturning(response: Response) {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mockFetchRejecting(err: Error) {
  const fn = vi.fn().mockRejectedValue(err);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('validatePublishedSeo', () => {
  let logger: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    logger = { warn: vi.fn(), info: vi.fn() };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns ok when all SEO elements present', async () => {
    mockFetchReturning(htmlResponse(FULL_HTML));
    const result = await validatePublishedSeo('https://example.com/', { logger });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith('seo.validation.result', {
      url: 'https://example.com/',
      ok: true,
      warningCount: 0,
    });
  });

  it('warns when <title> is missing', async () => {
    const html = FULL_HTML.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.ok).toBe(false);
    expect(result.warnings).toContain('missing-title');
  });

  it('warns when title is empty', async () => {
    const html = FULL_HTML.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '<title>   </title>');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('empty-title');
  });

  it('warns when description meta missing', async () => {
    const html = FULL_HTML.replace(/<meta\s+[^>]*name="description"[^>]*>/i, '');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('missing-description');
  });

  it('warns when h1 missing', async () => {
    const html = FULL_HTML.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '<div>no heading</div>');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('missing-h1');
  });

  it('warns when no JSON-LD script present', async () => {
    const html = FULL_HTML.replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/i, '');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('missing-json-ld');
  });

  it('warns when JSON-LD body is not valid JSON', async () => {
    const html = FULL_HTML.replace(
      /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/i,
      '<script type="application/ld+json">{ not valid json }</script>',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('invalid-json-ld');
  });

  it('warns empty-json-ld when the only block body is whitespace', async () => {
    const html = FULL_HTML.replace(
      /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/i,
      '<script type="application/ld+json">   </script>',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('empty-json-ld');
    expect(result.warnings).not.toContain('missing-json-ld');
    expect(result.warnings).not.toContain('invalid-json-ld');
  });

  it('re-throws non-SyntaxError from JSON.parse instead of swallowing as invalid-json-ld', async () => {
    // Pins the catch narrowing: only SyntaxError should map to
    // invalid-json-ld; a RangeError (or anything else) should surface so a
    // future flattening of the type guard fails loudly.
    mockFetchReturning(htmlResponse(FULL_HTML));
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(function () {
      throw new RangeError('synthetic non-SyntaxError');
    });
    try {
      await expect(validatePublishedSeo('https://e.com/', { logger })).rejects.toThrow(
        /synthetic non-SyntaxError/,
      );
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('passes JSON-LD check when at least one block is valid', async () => {
    // Pages with multiple JSON-LD blocks should not fail if any block parses —
    // one malformed block shouldn't mask sibling valid structured data.
    const html = FULL_HTML.replace(
      /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/i,
      '<script type="application/ld+json">{ not valid json }</script>' +
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).not.toContain('invalid-json-ld');
    expect(result.warnings).not.toContain('missing-json-ld');
  });

  it('warns when og:title missing', async () => {
    const html = FULL_HTML.replace(/<meta\s+[^>]*property="og:title"[^>]*>/i, '');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('missing-og-title');
  });

  it('warns when og:image missing', async () => {
    const html = FULL_HTML.replace(/<meta\s+[^>]*property="og:image"[^>]*>/i, '');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('missing-og-image');
  });

  it('warns when canonical link missing', async () => {
    const html = FULL_HTML.replace(/<link\s+[^>]*rel="canonical"[^>]*>/i, '');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('missing-canonical');
  });

  it('warns when canonical is not absolute', async () => {
    const html = FULL_HTML.replace(
      /<link\s+[^>]*rel="canonical"[^>]*>/i,
      '<link rel="canonical" href="/relative">',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('invalid-canonical-url');
  });

  it('warns when canonical is protocol-relative', async () => {
    const html = FULL_HTML.replace(
      /<link\s+[^>]*rel="canonical"[^>]*>/i,
      '<link rel="canonical" href="//example.com/path">',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('invalid-canonical-url');
  });

  it('warns when og:image contains an unescaped space', async () => {
    const html = FULL_HTML.replace(
      /<meta\s+[^>]*property="og:image"[^>]*>/i,
      '<meta property="og:image" content="https://example.com/og?title=Bad Image">',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('invalid-og-image-url');
  });

  it('warns when og:url is relative', async () => {
    const html = FULL_HTML.replace(
      /<meta\s+[^>]*property="og:url"[^>]*>/i,
      '<meta property="og:url" content="/relative">',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('invalid-og-url-url');
  });

  it('warns when twitter:image is relative', async () => {
    const html = FULL_HTML.replace(
      /<meta\s+[^>]*name="twitter:image"[^>]*>/i,
      '<meta name="twitter:image" content="/relative.png">',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('invalid-twitter-image-url');
  });

  it('warns when a public page unexpectedly contains noindex', async () => {
    const html = FULL_HTML.replace(
      '</head>',
      '<meta name="robots" content="noindex, nofollow"></head>',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.warnings).toContain('unexpected-noindex');
  });

  it('warns when noindex is expected but robots meta is missing', async () => {
    mockFetchReturning(htmlResponse(FULL_HTML));
    const result = await validatePublishedSeo('https://e.com/history', {
      logger,
      expectNoindex: true,
    });
    expect(result.warnings).toContain('missing-noindex');
  });

  it('warns when noindex is expected but robots meta lacks noindex', async () => {
    const html = FULL_HTML.replace('</head>', '<meta name="robots" content="nofollow"></head>');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/history', {
      logger,
      expectNoindex: true,
    });
    expect(result.warnings).toContain('missing-noindex');
  });

  it('can validate that an internal page is noindex', async () => {
    const html = FULL_HTML.replace(
      '</head>',
      '<meta name="robots" content="noindex nofollow"></head>',
    );
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/history', {
      logger,
      expectNoindex: true,
    });
    expect(result.warnings).not.toContain('missing-noindex');
    expect(result.warnings).not.toContain('unexpected-noindex');
  });

  it('treats robots none as noindex', async () => {
    const html = FULL_HTML.replace('</head>', '<meta name="robots" content="none"></head>');
    mockFetchReturning(htmlResponse(html));
    const result = await validatePublishedSeo('https://e.com/history', {
      logger,
      expectNoindex: true,
    });
    expect(result.warnings).not.toContain('missing-noindex');
    expect(result.warnings).not.toContain('unexpected-noindex');
  });

  it('returns fetch-failed warning on network error', async () => {
    mockFetchRejecting(new Error('ECONNREFUSED'));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('fetch failed');
    expect(result.warnings[0]).toContain('ECONNREFUSED');
    expect(logger.warn).toHaveBeenCalledWith(
      'seo.validation.fetch-failed',
      expect.objectContaining({ url: 'https://e.com/' }),
    );
  });

  it('returns fetch-failed warning on non-2xx response', async () => {
    mockFetchReturning(new Response('Not Found', { status: 404 }));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('404');
  });

  it('aggregates multiple missing elements into warnings array', async () => {
    const minimal = '<!doctype html><html><head></head><body></body></html>';
    mockFetchReturning(htmlResponse(minimal));
    const result = await validatePublishedSeo('https://e.com/', { logger });
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'missing-title',
        'missing-description',
        'missing-h1',
        'missing-json-ld',
        'missing-og-title',
        'missing-og-description',
        'missing-og-image',
        'missing-og-url',
        'missing-og-type',
        'missing-twitter-card',
        'missing-twitter-image',
        'missing-canonical',
      ]),
    );
    expect(result.warnings.length).toBe(12);
  });

  it.each([
    ['description', 'meta[name="description"]', /<meta\s+[^>]*name="description"[^>]*>/i, '<meta name="description" content="">'],
    ['og-title', 'meta[property="og:title"]', /<meta\s+[^>]*property="og:title"[^>]*>/i, '<meta property="og:title" content="">'],
    ['og-description', 'meta[property="og:description"]', /<meta\s+[^>]*property="og:description"[^>]*>/i, '<meta property="og:description" content="">'],
    ['og-image', 'meta[property="og:image"]', /<meta\s+[^>]*property="og:image"[^>]*>/i, '<meta property="og:image" content="">'],
    ['canonical', 'link[rel="canonical"]', /<link\s+[^>]*rel="canonical"[^>]*>/i, '<link rel="canonical" href="">'],
  ])(
    'warns when %s has empty content',
    async (code, _desc, pattern, replacement) => {
      const html = FULL_HTML.replace(pattern, replacement);
      mockFetchReturning(htmlResponse(html));
      const result = await validatePublishedSeo('https://e.com/', { logger });
      expect(result.warnings).toContain(`empty-${code}`);
    },
  );

  it('emits fetch timeout warning when request exceeds timeoutMs', async () => {
    // Exercises the AbortController path: a fetch that never resolves must
    // be aborted by the signal rather than hanging indefinitely.
    const abortedFetch = vi.fn().mockImplementation(function (_url, opts: RequestInit) { return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      }); },
    );
    vi.stubGlobal('fetch', abortedFetch);
    const result = await validatePublishedSeo('https://e.com/', { logger, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('fetch failed');
    expect(abortedFetch).toHaveBeenCalledWith(
      'https://e.com/',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('logs seo.validation.missing for each failed check and result once', async () => {
    const minimal = '<!doctype html><html><head><title>T</title></head><body><h1>H</h1></body></html>';
    mockFetchReturning(htmlResponse(minimal));
    const result = await validatePublishedSeo('https://e.com/', { logger });

    const missingCalls = logger.warn.mock.calls.filter((c) => c[0] === 'seo.validation.missing');
    expect(missingCalls.length).toBe(result.warnings.length);
    for (const call of missingCalls) {
      expect(call[1]).toEqual(expect.objectContaining({ url: 'https://e.com/' }));
      expect(typeof (call[1] as { check: string }).check).toBe('string');
    }

    const resultCalls = logger.warn.mock.calls.filter((c) => c[0] === 'seo.validation.result');
    expect(resultCalls.length).toBe(1);
    expect(resultCalls[0][1]).toEqual({
      url: 'https://e.com/',
      ok: false,
      warningCount: result.warnings.length,
    });
  });
});
