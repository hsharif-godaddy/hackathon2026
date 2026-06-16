type JsonObject = Record<string, unknown>;

const JSON_LD_RE = /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function readType(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const type = readType(item);
      if (type) return type;
    }
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

export type AeoStructureCheckOptions = {
  /** Published/preview URL for this route (URL consistency checks). */
  pageUrl?: string;
  /** When true, flag meta/JSON-LD URLs that differ from pageUrl (published HTML audits only). */
  validateAgainstScannedUrl?: boolean;
};

export function parseJsonLdBlocks(html: string): JsonObject[] {
  const blocks: JsonObject[] = [];
  for (const match of html.matchAll(JSON_LD_RE)) {
    const body = (match[1] || '').trim();
    if (!body) {
      continue;
    }
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object') {
        blocks.push(parsed as JsonObject);
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        throw err;
      }
    }
  }
  return blocks;
}

export function flattenSchemaNodes(value: unknown): JsonObject[] {
  const nodes: JsonObject[] = [];

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }

    const record = node as JsonObject;
    if (readType(record['@type'])) {
      nodes.push(record);
    }

    if (Array.isArray(record['@graph'])) {
      walk(record['@graph']);
    }
    if (record.mainEntity) {
      walk(record.mainEntity);
    }
  }

  walk(value);
  return nodes;
}

export function extractSchemaTypesFromHtml(html: string): string[] {
  const blocks = parseJsonLdBlocks(html);
  const types = new Set<string>();
  for (const block of blocks) {
    for (const node of flattenSchemaNodes(block)) {
      const type = readType(node['@type']);
      if (type) {
        types.add(type);
      }
    }
  }
  return [...types];
}

const PAGE_SCHEMA_URL_TYPES = new Set([
  'WebPage',
  'AboutPage',
  'BlogPosting',
  'Article',
  'FAQPage',
  'ContactPage',
  'Product',
  'Service',
]);

const HOMEPAGE_SCHEMA_URL_TYPES = new Set(['WebSite', 'Organization', 'WebPage']);

function isAbsoluteHttpUrl(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizePageUrl(value: string): string | null {
  if (!isAbsoluteHttpUrl(value)) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.href;
  } catch {
    return null;
  }
}

function extractCanonicalUrl(html: string): string | null {
  const match = html.match(/<link\s+[^>]*\brel=["']canonical["'][^>]*>/i);
  if (!match) {
    return null;
  }
  const hrefMatch = match[0].match(/\bhref=["']([^"']*)["']/i);
  return hrefMatch?.[1]?.trim() ?? null;
}

function extractOgUrl(html: string): string | null {
  const match = html.match(/<meta\s+[^>]*\bproperty=["']og:url["'][^>]*>/i);
  if (!match) {
    return null;
  }
  const contentMatch = match[0].match(/\bcontent=["']([^"']*)["']/i);
  return contentMatch?.[1]?.trim() ?? null;
}

function readSchemaPageUrl(node: JsonObject, routePath: string): string | null {
  const type = readType(node['@type']);
  if (!type) {
    return null;
  }
  if (routePath === '/') {
    return HOMEPAGE_SCHEMA_URL_TYPES.has(type) ? readString(node.url) : null;
  }
  if (type === 'WebSite') {
    return null;
  }
  return PAGE_SCHEMA_URL_TYPES.has(type) ? readString(node.url) : null;
}

function validateScannedPageUrlConsistency(
  html: string,
  nodes: JsonObject[],
  routePath: string,
  pageUrl: string | undefined,
  validateAgainstScannedUrl: boolean | undefined,
  issues: string[],
): void {
  if (!validateAgainstScannedUrl || !pageUrl) {
    return;
  }

  const scanned = normalizePageUrl(pageUrl);
  if (!scanned) {
    return;
  }

  const canonical = extractCanonicalUrl(html);
  const normalizedCanonical = canonical ? normalizePageUrl(canonical) : null;
  if (normalizedCanonical && normalizedCanonical !== scanned) {
    issues.push('aeo-url-mismatch:canonical-page');
  }

  const ogUrl = extractOgUrl(html);
  const normalizedOg = ogUrl ? normalizePageUrl(ogUrl) : null;
  if (normalizedOg && normalizedOg !== scanned) {
    issues.push('aeo-url-mismatch:og-page');
  }

  for (const node of nodes) {
    const schemaUrl = readSchemaPageUrl(node, routePath);
    if (!schemaUrl) {
      continue;
    }
    const normalizedSchema = normalizePageUrl(schemaUrl);
    if (normalizedSchema && normalizedSchema !== scanned) {
      issues.push('aeo-url-mismatch:jsonld-page');
      return;
    }
  }
}

function validateUrlConsistency(
  html: string,
  nodes: JsonObject[],
  routePath: string,
  pageUrl: string | undefined,
  issues: string[],
): void {
  const canonical = extractCanonicalUrl(html);
  const reference =
    (canonical ? normalizePageUrl(canonical) : null) ??
    (pageUrl ? normalizePageUrl(pageUrl) : null);
  if (!reference) {
    return;
  }

  const ogUrl = extractOgUrl(html);
  const normalizedOg = ogUrl ? normalizePageUrl(ogUrl) : null;
  if (normalizedOg && normalizedOg !== reference) {
    issues.push('aeo-url-mismatch:head');
  }

  for (const node of nodes) {
    const schemaUrl = readSchemaPageUrl(node, routePath);
    if (!schemaUrl) {
      continue;
    }
    const normalizedSchema = normalizePageUrl(schemaUrl);
    if (normalizedSchema && normalizedSchema !== reference) {
      issues.push('aeo-url-mismatch:jsonld');
      return;
    }
  }
}

/** AEO checks: URL consistency + JSON-LD @type presence (recommended types are fix guidance only). */
export function runAeoStructureChecks(
  html: string,
  routePath: string,
  options?: AeoStructureCheckOptions,
): string[] {
  const issues: string[] = [];
  const blocks = parseJsonLdBlocks(html);
  const nodes = blocks.flatMap(block => flattenSchemaNodes(block));

  validateUrlConsistency(html, nodes, routePath, options?.pageUrl, issues);
  validateScannedPageUrlConsistency(
    html,
    nodes,
    routePath,
    options?.pageUrl,
    options?.validateAgainstScannedUrl,
    issues,
  );

  if (blocks.length === 0) {
    return issues;
  }

  let hasType = false;
  for (const node of nodes) {
    if (readType(node['@type'])) {
      hasType = true;
      break;
    }
  }

  if (!hasType) {
    issues.push('aeo-missing-schema-type');
  }

  return issues;
}
