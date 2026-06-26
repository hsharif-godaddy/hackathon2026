import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractBodyHtml,
  escapeRegExp,
  clamp01,
  readSnapshotHtml,
  sigmoidScore,
  SIGMOID_MIDPOINT,
  SIGMOID_STEEPNESS,
  extractBodyHtmlFull,
  sanitizeHtmlForEval,
  lastSnapshotSectionSanitized,
} from '../shared.js';
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
  // vitest 4: resetAllMocks (not restoreAllMocks) — see catalog notes.
  afterEach(() => vi.resetAllMocks());

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

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

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

describe('sigmoidScore', () => {
  const midpoint = 15;
  const steepness = 0.2;

  it('exports shared SIGMOID_MIDPOINT and SIGMOID_STEEPNESS constants', () => {
    expect(SIGMOID_MIDPOINT).toBe(15);
    expect(SIGMOID_STEEPNESS).toBe(0.2);
  });

  it('returns 0.5 at the midpoint', () => {
    expect(sigmoidScore(midpoint, midpoint, steepness)).toBeCloseTo(0.5, 10);
  });

  it('returns high score for low counts', () => {
    expect(sigmoidScore(1, midpoint, steepness)).toBeGreaterThan(0.9);
    expect(sigmoidScore(5, midpoint, steepness)).toBeGreaterThan(0.85);
  });

  it('returns low score for high counts', () => {
    expect(sigmoidScore(30, midpoint, steepness)).toBeLessThan(0.1);
  });

  it('is monotonically decreasing', () => {
    expect(sigmoidScore(5, midpoint, steepness)).toBeGreaterThan(sigmoidScore(10, midpoint, steepness));
    expect(sigmoidScore(10, midpoint, steepness)).toBeGreaterThan(sigmoidScore(20, midpoint, steepness));
    expect(sigmoidScore(20, midpoint, steepness)).toBeGreaterThan(sigmoidScore(30, midpoint, steepness));
  });

  it('returns value in (0, 1) for any non-negative count', () => {
    expect(sigmoidScore(0, midpoint, steepness)).toBeGreaterThan(0);
    expect(sigmoidScore(0, midpoint, steepness)).toBeLessThan(1);
    expect(sigmoidScore(100, midpoint, steepness)).toBeGreaterThan(0);
    expect(sigmoidScore(100, midpoint, steepness)).toBeLessThan(1);
  });

  it('throws RangeError when count is NaN', () => {
    expect(() => sigmoidScore(NaN, midpoint, steepness)).toThrow(RangeError);
  });

  it('throws RangeError when count is negative', () => {
    expect(() => sigmoidScore(-5, midpoint, steepness)).toThrow(RangeError);
  });

  it('throws RangeError when midpoint is NaN', () => {
    expect(() => sigmoidScore(5, NaN, steepness)).toThrow(RangeError);
  });

  it('throws RangeError when midpoint is Infinity', () => {
    expect(() => sigmoidScore(5, Infinity, steepness)).toThrow(RangeError);
  });

  it('throws RangeError when steepness is 0', () => {
    expect(() => sigmoidScore(5, midpoint, 0)).toThrow(RangeError);
  });

  it('throws RangeError when steepness is negative', () => {
    expect(() => sigmoidScore(5, midpoint, -0.1)).toThrow(RangeError);
  });

  it('throws RangeError when steepness is NaN', () => {
    expect(() => sigmoidScore(5, midpoint, NaN)).toThrow(RangeError);
  });
});

describe('extractBodyHtmlFull', () => {
  it('returns body innerHTML without truncation for large bodies', () => {
    const longBody = 'x'.repeat(25_000);
    const html = `<html><body>${longBody}</body></html>`;
    const result = extractBodyHtmlFull(html);
    expect(result).toBe(longBody);
    expect(result).not.toContain('[truncated]');
    expect(result.length).toBe(25_000);
  });

  it('falls back to full HTML when no <body> tag is present', () => {
    const html = '<h1>No body tag here</h1>';
    expect(extractBodyHtmlFull(html)).toBe('<h1>No body tag here</h1>');
  });

  it('extracts body content when <body> has attributes', () => {
    const html = '<html><body class="dark" data-theme="night"><p>hello</p></body></html>';
    expect(extractBodyHtmlFull(html)).toBe('<p>hello</p>');
  });
});

describe('sanitizeHtmlForEval', () => {
  describe('stripping', () => {
    it('strips SVG elements and their content', () => {
      const html = '<div><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg><p>text</p></div>';
      expect(sanitizeHtmlForEval(html)).not.toContain('<svg');
      expect(sanitizeHtmlForEval(html)).not.toContain('<path');
      expect(sanitizeHtmlForEval(html)).toContain('<p>text</p>');
    });

    it('strips multiple separate SVG elements', () => {
      const html = '<div><svg><circle/></svg><p>between</p><svg><rect/></svg></div>';
      const result = sanitizeHtmlForEval(html);
      expect(result).not.toContain('<svg');
      expect(result).not.toContain('</svg>');
      expect(result).toContain('between');
    });

    it('strips nested SVG elements without leaving orphaned tags', () => {
      const html = '<div><svg><svg>inner</svg></svg><p>after</p></div>';
      const result = sanitizeHtmlForEval(html);
      expect(result).not.toContain('<svg');
      expect(result).not.toContain('</svg>');
      expect(result).toContain('after');
    });

    it('strips <style> elements and their content', () => {
      const html = '<div><style>.foo { color: red; }</style><p>text</p></div>';
      expect(sanitizeHtmlForEval(html)).not.toContain('<style');
      expect(sanitizeHtmlForEval(html)).not.toContain('color: red');
      expect(sanitizeHtmlForEval(html)).toContain('text');
    });

    it('strips <script> elements and their content', () => {
      const html = '<div><script>var x = 1;</script><p>text</p></div>';
      expect(sanitizeHtmlForEval(html)).not.toContain('<script');
      expect(sanitizeHtmlForEval(html)).not.toContain('var x');
      expect(sanitizeHtmlForEval(html)).toContain('text');
    });

    it('strips double-quoted class attributes', () => {
      const html = '<div class="flex items-center text-gray-900"><p>text</p></div>';
      expect(sanitizeHtmlForEval(html)).toBe('<div><p>text</p></div>');
    });

    it('strips single-quoted class attributes', () => {
      const html = "<div class='flex items-center'><p>text</p></div>";
      expect(sanitizeHtmlForEval(html)).toBe('<div><p>text</p></div>');
    });

    it('strips inline style attributes', () => {
      const html = '<div style="color: red; font-size: 16px"><p>text</p></div>';
      expect(sanitizeHtmlForEval(html)).toBe('<div><p>text</p></div>');
    });

    it('strips data-dev-* attributes', () => {
      const html = '<div data-dev-env="production" data-dev-config="abc"><p>text</p></div>';
      const result = sanitizeHtmlForEval(html);
      expect(result).not.toContain('data-dev-env');
      expect(result).not.toContain('data-dev-config');
      expect(result).toContain('text');
    });

    it('strips data-discover attributes', () => {
      const html = '<div data-discover="true"><p>text</p></div>';
      const result = sanitizeHtmlForEval(html);
      expect(result).not.toContain('data-discover');
      expect(result).toContain('text');
    });

    it('collapses inter-tag whitespace', () => {
      const html = '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>';
      const result = sanitizeHtmlForEval(html);
      expect(result).toBe('<ul><li>one</li><li>two</li></ul>');
    });
  });

  describe('preservation', () => {
    it('preserves href attributes on anchor tags', () => {
      const html = '<a href="tel:+15551234567">Call us</a>';
      expect(sanitizeHtmlForEval(html)).toBe('<a href="tel:+15551234567">Call us</a>');
    });

    it('preserves mailto: href', () => {
      const html = '<a href="mailto:hello@example.com">Email</a>';
      expect(sanitizeHtmlForEval(html)).toContain('href="mailto:hello@example.com"');
    });

    it('preserves src attributes on img tags', () => {
      const html = '<img src="/logo.png" alt="Logo">';
      expect(sanitizeHtmlForEval(html)).toBe('<img src="/logo.png" alt="Logo">');
    });

    it('preserves alt attributes', () => {
      const html = '<img src="/img.png" alt="A beautiful sunset">';
      expect(sanitizeHtmlForEval(html)).toContain('alt="A beautiful sunset"');
    });

    it('preserves action attributes on forms', () => {
      const html = '<form action="/submit"><button>Submit</button></form>';
      expect(sanitizeHtmlForEval(html)).toContain('action="/submit"');
    });

    it('preserves id attributes', () => {
      const html = '<section id="contact-section"><p>Contact</p></section>';
      expect(sanitizeHtmlForEval(html)).toContain('id="contact-section"');
    });

    it('preserves aria-label attributes', () => {
      const html = '<button aria-label="Close dialog">×</button>';
      expect(sanitizeHtmlForEval(html)).toContain('aria-label="Close dialog"');
    });

    it('preserves role attributes', () => {
      const html = '<nav role="navigation"><a href="/">Home</a></nav>';
      expect(sanitizeHtmlForEval(html)).toContain('role="navigation"');
    });

    it('preserves text content', () => {
      const html = '<h1>Welcome to our bakery</h1><p>We bake fresh bread daily.</p>';
      const result = sanitizeHtmlForEval(html);
      expect(result).toContain('Welcome to our bakery');
      expect(result).toContain('We bake fresh bread daily.');
    });

    it('preserves semantic tags (h1, p, a, form, nav, section, footer)', () => {
      const html = '<main><h1>Title</h1><nav><a href="/">Home</a></nav><footer><p>© 2024</p></footer></main>';
      const result = sanitizeHtmlForEval(html);
      expect(result).toContain('<main>');
      expect(result).toContain('<h1>');
      expect(result).toContain('<nav>');
      expect(result).toContain('<footer>');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeHtmlForEval('')).toBe('');
    });

    it('returns empty string for purely-SVG body', () => {
      const html = '  <svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>  ';
      expect(sanitizeHtmlForEval(html)).toBe('');
    });

    it('returns input unchanged (modulo whitespace) when nothing to strip', () => {
      const html = '<h1>Title</h1><p>Content</p>';
      expect(sanitizeHtmlForEval(html)).toBe('<h1>Title</h1><p>Content</p>');
    });

    it('strips multiple noise patterns in a single element', () => {
      const html = '<div class="flex" style="color:red" data-dev-env="prod" data-discover="true" id="hero"><p>hello</p></div>';
      const result = sanitizeHtmlForEval(html);
      expect(result).toContain('id="hero"');
      expect(result).not.toContain('class=');
      expect(result).not.toContain('style=');
      expect(result).not.toContain('data-dev-');
      expect(result).not.toContain('data-discover=');
    });
  });
});

describe('lastSnapshotSectionSanitized', () => {
  afterEach(() => vi.resetAllMocks());

  function makeSnapshot(overrides: Partial<DOMSnapshot> = {}): DOMSnapshot {
    return {
      url: 'http://localhost:3000/preview',
      screenshotPath: '/tmp/snap.png',
      htmlPath: '/tmp/snap.html',
      timestamp: '2026-01-01T00:00:00.000Z',
      consoleLogs: [],
      ...overrides,
    };
  }

  it('returns "(no snapshot)" when snapshot is undefined', async () => {
    expect(await lastSnapshotSectionSanitized(undefined)).toBe('(no snapshot)');
  });

  it('output contains URL, BODY_HTML (sanitized), BODY_TEXT, and CONSOLE_LOGS sections', async () => {
    const snapshot = makeSnapshot({
      html: '<html><body><h1>Hello</h1></body></html>',
      consoleLogs: [],
    });
    const result = await lastSnapshotSectionSanitized(snapshot);
    expect(result).toContain('URL: http://localhost:3000/preview');
    expect(result).toContain('BODY_HTML (sanitized):');
    expect(result).toContain('BODY_TEXT:');
    expect(result).toContain('CONSOLE_LOGS (tail):');
  });

  it('SVG content is stripped from BODY_HTML section', async () => {
    const snapshot = makeSnapshot({
      html: '<html><body><svg><path d="M0 0"/></svg><h1>Services</h1></body></html>',
    });
    const result = await lastSnapshotSectionSanitized(snapshot);
    expect(result).not.toContain('<svg');
    expect(result).not.toContain('<path');
    expect(result).toContain('<h1>Services</h1>');
  });

  it('no truncation applied: large body passes through fully sanitized', async () => {
    const repeated = '<p>hello</p>'.repeat(2_000);
    const snapshot = makeSnapshot({
      html: `<html><body>${repeated}</body></html>`,
    });
    const result = await lastSnapshotSectionSanitized(snapshot);
    expect(result).not.toContain('[truncated]');
    expect(result).toContain('<p>hello</p>');
  });

  it('includes console logs in CONSOLE_LOGS section', async () => {
    const snapshot = makeSnapshot({
      html: '<html><body><p>text</p></body></html>',
      consoleLogs: [
        { type: 'error', text: 'Uncaught ReferenceError: foo is not defined' },
      ],
    });
    const result = await lastSnapshotSectionSanitized(snapshot);
    expect(result).toContain('error: Uncaught ReferenceError');
  });

  it('truncates sanitized HTML exceeding LLM_PROMPT_SANITIZED_HTML_MAX_CHARS', async () => {
    const largeParagraph = '<p>' + 'a'.repeat(60_000) + '</p>';
    const snapshot = makeSnapshot({
      html: `<html><body>${largeParagraph}</body></html>`,
    });

    const result = await lastSnapshotSectionSanitized(snapshot);
    expect(result).toContain('... [truncated]');
    expect(result).not.toContain('a'.repeat(60_000));
  });
});
