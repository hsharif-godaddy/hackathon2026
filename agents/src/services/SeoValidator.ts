/**
 * Advisory SEO validator. Fetches a published URL (no JS) and reports
 * missing SEO elements. Non-blocking.
 */

export type SeoCheckResult =
  | { ok: true; warnings: [] }
  | { ok: false; warnings: [string, ...string[]] };

interface ValidatorLogger {
  warn: (event: string, data: unknown) => void;
  info: (event: string, data: unknown) => void;
}

interface ValidateOptions {
  timeoutMs?: number;
  logger?: ValidatorLogger;
}

const DEFAULT_TIMEOUT_MS = 10000;

// Hardcoded regexes avoid Semgrep's non-literal-RegExp finding and pin
// the accepted attribute set. callers pass an `attr` keyword that indexes
// into this table instead of interpolating arbitrary text into RegExp().
const ATTR_EXTRACTORS = {
  content: /\bcontent=["']([^"']*)["']/i,
  href: /\bhref=["']([^"']*)["']/i,
} as const;
type AttrName = keyof typeof ATTR_EXTRACTORS;

const META_BY_ATTR = {
  'name:description': /<meta\s+[^>]*\bname=["']description["'][^>]*>/i,
  'property:og:title': /<meta\s+[^>]*\bproperty=["']og:title["'][^>]*>/i,
  'property:og:description': /<meta\s+[^>]*\bproperty=["']og:description["'][^>]*>/i,
  'property:og:image': /<meta\s+[^>]*\bproperty=["']og:image["'][^>]*>/i,
} as const;
type MetaSelector = keyof typeof META_BY_ATTR;

function extractAttr(tag: string, attr: AttrName): string | null {
  const m = tag.match(ATTR_EXTRACTORS[attr]);
  return m && m[1] !== undefined ? m[1] : null;
}

function findMetaContent(html: string, selector: MetaSelector): string | null {
  const m = html.match(META_BY_ATTR[selector]);
  if (!m) return null;
  return extractAttr(m[0], 'content');
}

function checkTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return 'missing-title';
  const text = (m[1] || '').trim();
  if (!text) return 'empty-title';
  return null;
}

function checkMeta(html: string, selector: MetaSelector, warningName: string): string | null {
  const content = findMetaContent(html, selector);
  if (content === null) return `missing-${warningName}`;
  if (!content.trim()) return `empty-${warningName}`;
  return null;
}

function checkH1(html: string): string | null {
  return /<h1[\s>]/i.test(html) ? null : 'missing-h1';
}

function checkJsonLd(html: string): string | null {
  const re = /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let found = false;
  let validFound = false;
  let hadEmpty = false;
  let hadInvalid = false;
  for (const m of html.matchAll(re)) {
    found = true;
    const body = (m[1] || '').trim();
    if (!body) {
      hadEmpty = true;
      continue;
    }
    try {
      JSON.parse(body);
      validFound = true;
    } catch (err) {
      if (err instanceof SyntaxError) {
        hadInvalid = true;
      } else {
        throw err;
      }
    }
  }
  if (!found) return 'missing-json-ld';
  if (validFound) return null;
  if (hadInvalid) return 'invalid-json-ld';
  if (hadEmpty) return 'empty-json-ld';
  return null;
}

function checkCanonical(html: string): string | null {
  const m = html.match(/<link\s+[^>]*\brel=["']canonical["'][^>]*>/i);
  if (!m) return 'missing-canonical';
  const href = extractAttr(m[0], 'href');
  if (!href || !href.trim()) return 'empty-canonical';
  return null;
}

function runChecks(html: string): string[] {
  const warnings: string[] = [];
  const add = (w: string | null) => {
    if (w) warnings.push(w);
  };

  add(checkTitle(html));
  add(checkMeta(html, 'name:description', 'description'));
  add(checkH1(html));
  add(checkJsonLd(html));
  add(checkMeta(html, 'property:og:title', 'og-title'));
  add(checkMeta(html, 'property:og:description', 'og-description'));
  add(checkMeta(html, 'property:og:image', 'og-image'));
  add(checkCanonical(html));

  return warnings;
}

export async function validatePublishedSeo(
  url: string,
  options?: ValidateOptions,
): Promise<SeoCheckResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options?.logger;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fetchFailed = (detail: string, data: Record<string, unknown>): SeoCheckResult => {
    logger?.warn('seo.validation.fetch-failed', { url, ...data });
    return { ok: false, warnings: [`fetch failed: ${detail}`] };
  };

  let html: string;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'AiroSeoValidator/1.0', Accept: 'text/html' },
      signal: controller.signal,
    });
    if (!res.ok) return fetchFailed(`HTTP ${res.status}`, { status: res.status });
    html = await res.text();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fetchFailed(reason, { error: reason });
  } finally {
    clearTimeout(timer);
  }

  const warnings = runChecks(html);
  for (const check of warnings) {
    logger?.warn('seo.validation.missing', { check, url });
  }

  if (warnings.length === 0) {
    logger?.info('seo.validation.result', { url, ok: true, warningCount: 0 });
    return { ok: true, warnings: [] };
  }
  logger?.warn('seo.validation.result', { url, ok: false, warningCount: warnings.length });
  return { ok: false, warnings: warnings as [string, ...string[]] };
}
