import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractBodyHtml, escapeRegExp, clamp01, readSnapshotHtml } from '../shared.js';
import type { DOMSnapshot } from '../../clients/dom-capture.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('extractBodyHtml', () => {
  it('returns correct body content for normal well-formed HTML', () => {
    const html = '<html><body><h1>Hello</h1><p>World</p></body></html>';
    expect(extractBodyHtml(html)).toBe('<h1>Hello</h1><p>World</p>');
  });

  it('falls back to full HTML when no <body> tag is present', () => {
    const html = '<h1>No body tag here</h1>';
    expect(extractBodyHtml(html)).toBe('<h1>No body tag here</h1>');
  });

  it('extracts full body content when </body> appears inside a <script> tag', () => {
    const inner =
      '<script>var x = "</body>";</script><div>Real content</div>';
    const html = `<html><body>${inner}</body></html>`;
    expect(extractBodyHtml(html)).toBe(inner);
  });

  it('truncates body content at 20K chars', () => {
    const filler = 'a'.repeat(25_000);
    const html = `<html><body>${filler}</body></html>`;
    const result = extractBodyHtml(html);
    expect(result.length).toBeLessThan(25_000);
    expect(result).toContain('[truncated]');
  });
});

describe('escapeRegExp', () => {
  it('escapes all regex metacharacters', () => {
    const input = '[(.+$^{|\\)';
    const escaped = escapeRegExp(input);
    // Each metachar should be preceded by a backslash — verify no SyntaxError
    expect(() => new RegExp(escaped)).not.toThrow();
    // Literal string must match itself when used as a pattern
    expect(new RegExp(escaped).test(input)).toBe(true);
  });

  it('leaves non-metacharacter strings unchanged', () => {
    expect(escapeRegExp('hello')).toBe('hello');
    expect(escapeRegExp('foo-bar_baz')).toBe('foo-bar_baz');
  });

  it('escapes [ character', () => {
    expect(escapeRegExp('[')).toBe('\\[');
  });

  it('escapes ( character', () => {
    expect(escapeRegExp('(')).toBe('\\(');
  });

  it('escapes . character', () => {
    expect(escapeRegExp('.')).toBe('\\.');
  });

  it('escapes + character', () => {
    expect(escapeRegExp('+')).toBe('\\+');
  });

  it('escapes $ character', () => {
    expect(escapeRegExp('$')).toBe('\\$');
  });

  it('escapes ^ character', () => {
    expect(escapeRegExp('^')).toBe('\\^');
  });

  it('escapes { character', () => {
    expect(escapeRegExp('{')).toBe('\\{');
  });

  it('escapes | character', () => {
    expect(escapeRegExp('|')).toBe('\\|');
  });

  it('escapes \\ character', () => {
    expect(escapeRegExp('\\')).toBe('\\\\');
  });

  it('escapes ) character', () => {
    expect(escapeRegExp(')')).toBe('\\)');
  });
});

describe('clamp01', () => {
  it('returns 0 for input 0', () => {
    expect(clamp01(0)).toBe(0);
  });

  it('returns 1 for input 1', () => {
    expect(clamp01(1)).toBe(1);
  });

  it('clamps -0.5 to 0', () => {
    expect(clamp01(-0.5)).toBe(0);
  });

  it('clamps 1.5 to 1', () => {
    expect(clamp01(1.5)).toBe(1);
  });

  it('passes through a mid-range value unchanged', () => {
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe('readSnapshotHtml', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns empty string when snapshot is undefined', async () => {
    const result = await readSnapshotHtml(undefined);
    expect(result).toBe('');
  });

  it('returns empty string when snapshot.htmlPath is an empty string', async () => {
    const snapshot = { htmlPath: '' } as unknown as DOMSnapshot;
    const result = await readSnapshotHtml(snapshot);
    expect(result).toBe('');
  });

  it('returns file content when readFile resolves successfully', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('<html><body>hello</body></html>' as string);

    const snapshot: DOMSnapshot = {
      url: 'http://localhost',
      screenshotPath: '/tmp/screenshot.png',
      htmlPath: '/tmp/snapshot.html',
      timestamp: '2024-01-01T00:00:00.000Z',
      consoleLogs: [],
    };

    const result = await readSnapshotHtml(snapshot);
    expect(result).toBe('<html><body>hello</body></html>');
  });

  it('returns empty string and calls console.warn when readFile throws', async () => {
    const { readFile } = await import('node:fs/promises');
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValue(enoent);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const snapshot: DOMSnapshot = {
      url: 'http://localhost',
      screenshotPath: '/tmp/screenshot.png',
      htmlPath: '/tmp/missing.html',
      timestamp: '2024-01-01T00:00:00.000Z',
      consoleLogs: [],
    };

    const result = await readSnapshotHtml(snapshot);

    expect(result).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('readSnapshotHtml'),
      expect.stringContaining('/tmp/missing.html'),
      expect.stringContaining('ENOENT'),
    );
  });

  it('returns inline html when snapshot.html is defined', async () => {
    const snapshot: DOMSnapshot = {
      url: 'http://localhost',
      screenshotPath: '/tmp/s.png',
      htmlPath: '/tmp/s.html',
      timestamp: '2024-01-01T00:00:00.000Z',
      consoleLogs: [],
      html: '<div>inline</div>',
    };
    const result = await readSnapshotHtml(snapshot);
    expect(result).toBe('<div>inline</div>');
  });

  it('prefers inline html over htmlPath when both present', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('<html>from-file</html>' as string);

    const snapshot: DOMSnapshot = {
      url: 'http://localhost',
      screenshotPath: '/tmp/s.png',
      htmlPath: '/tmp/s.html',
      timestamp: '2024-01-01T00:00:00.000Z',
      consoleLogs: [],
      html: '<div>inline wins</div>',
    };
    const result = await readSnapshotHtml(snapshot);
    expect(result).toBe('<div>inline wins</div>');
    expect(readFile).not.toHaveBeenCalled();
  });
});
