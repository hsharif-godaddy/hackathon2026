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
  expectNoindex?: boolean;
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
  'name:robots': /<meta\s+[^>]*\bname=["']robots["'][^>]*>/i,
  'name:twitter:card': /<meta\s+[^>]*\bname=["']twitter:card["'][^>]*>/i,
  'name:twitter:image': /<meta\s+[^>]*\bname=["']twitter:image["'][^>]*>/i,
  'property:og:title': /<meta\s+[^>]*\bproperty=["']og:title["'][^>]*>/i,
  'property:og:description': /<meta\s+[^>]*\bproperty=["']og:description["'][^>]*>/i,
  'property:og:image': /<meta\s+[^>]*\bproperty=["']og:image["'][^>]*>/i,
  'property:og:type': /<meta\s+[^>]*\bproperty=["']og:type["'][^>]*>/i,
  'property:og:url': /<meta\s+[^>]*\bproperty=["']og:url["'][^>]*>/i,
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

function isAbsoluteHttpUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function checkUrlMeta(html: string, selector: MetaSelector, warningName: string): string | null {
  const content = findMetaContent(html, selector);
  if (content === null) return `missing-${warningName}`;
  if (!content.trim()) return `empty-${warningName}`;
  if (!isAbsoluteHttpUrl(content.trim())) return `invalid-${warningName}-url`;
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
  if (!isAbsoluteHttpUrl(href.trim())) return 'invalid-canonical-url';
  return null;
}

function checkRobotsNoindex(html: string, expectNoindex: boolean): string | null {
  const robots = findMetaContent(html, 'name:robots');
  const robotsTokens = robots?.toLowerCase().split(/[\s,]+/).filter(Boolean) ?? [];
  const hasNoindex = robotsTokens.includes('noindex') || robotsTokens.includes('none');
  if (expectNoindex && !hasNoindex) return 'missing-noindex';
  if (!expectNoindex && hasNoindex) return 'unexpected-noindex';
  return null;
}

function runChecks(html: string, options?: Pick<ValidateOptions, 'expectNoindex'>): string[] {
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
  add(checkUrlMeta(html, 'property:og:image', 'og-image'));
  add(checkUrlMeta(html, 'property:og:url', 'og-url'));
  add(checkMeta(html, 'property:og:type', 'og-type'));
  add(checkMeta(html, 'name:twitter:card', 'twitter-card'));
  add(checkUrlMeta(html, 'name:twitter:image', 'twitter-image'));
  add(checkCanonical(html));
  add(checkRobotsNoindex(html, Boolean(options?.expectNoindex)));

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

  const warnings = runChecks(html, { expectNoindex: options?.expectNoindex });
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
