import { describe, it, expect } from 'vitest';
import {
  hasRenderedContent,
  visibleTextLength,
  MIN_CONTENT_CHARS,
} from '../rendered-content.js';
import type { CapturedSite } from '../../../clients/site-capture/types.js';
import type { DOMSnapshot } from '../../../runner/transcript.js';

function site(rendered?: Partial<CapturedSite['perRoute'][number]['rendered']>): CapturedSite {
  return {
    previewUrl: 'http://t',
    generatedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 0,
    outputDir: '/tmp',
    routes: [{ path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' }],
    perRoute: rendered
      ? [
          {
            route: { path: '/', url: 'http://t/', origin: 'homepage', status: 'ok' },
            rendered: { title: '', h1: null, headingText: '', bodyPreview: '', ...rendered },
            perViewport: { mobile: { tiles: [] }, laptop: { tiles: [] } },
          },
        ]
      : [],
    errors: [],
  };
}

function snap(html: string): DOMSnapshot {
  return {
    url: 'http://t/',
    screenshotPath: '/tmp/s.png',
    htmlPath: '/tmp/s.html',
    timestamp: '2026-01-01T00:00:00.000Z',
    consoleLogs: [],
    html,
  };
}

describe('rendered-content matcher', () => {
  it('visibleTextLength strips tags/scripts/styles', () => {
    expect(visibleTextLength('<style>x{}</style><h1>Hello World Here</h1>')).toBe(
      'Hello World Here'.length,
    );
  });

  it('passes via rendered signals', () => {
    expect(hasRenderedContent(site({ bodyPreview: 'A real sentence of copy' }), [])).toBe(true);
  });

  it('falls back to snapshot HTML when rendered signals are empty', () => {
    const html = `<body><p>${'x'.repeat(MIN_CONTENT_CHARS + 10)}</p></body>`;
    expect(hasRenderedContent(site({}), [snap(html)])).toBe(true);
  });

  it('returns false when both rendered signals and HTML are blank', () => {
    expect(hasRenderedContent(site({}), [snap('<body></body>')])).toBe(false);
  });
});
