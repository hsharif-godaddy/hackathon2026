import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { ExecutionContext, ExecutionContextMetadata } from '@airo/ai-grants';

import { labelForSeoCheck } from './seo-audit-labels.js';
import { SEO_SOURCE_CHECKS } from './SeoPageInjector.js';
import {
  extractRoutePageSignals,
  recommendAeoSchemaTypes,
  type AeoRouteSchemaGuidance,
} from './aeo-schema-recommendations.js';
import {
  buildSeoStrategyContext,
  type SeoStrategyContext,
  type SeoStrategyInput,
} from './seo-strategy-context.js';
import { extractSchemaTypesFromHtml, runAeoStructureChecks } from './aeo-structure-validator.js';
import { fetchPublishedPageHtml, runSeoHtmlChecks, type SeoCheckResult } from './SeoValidator.js';

export type { SeoStrategyContext } from './seo-strategy-context.js';

export type SeoIssueSeverity = 'critical' | 'warning' | 'info';

export type SeoAuditIssue = {
  code: string;
  label: string;
  severity: SeoIssueSeverity;
};

export function severityForSeoCheck(code: string): SeoIssueSeverity {
  if (code.startsWith('fetch failed')) {
    return 'critical';
  }
  if (
    code === 'missing-title' ||
    code === 'empty-title' ||
    code === 'missing-description' ||
    code === 'empty-description' ||
    code === 'missing-h1' ||
    code === 'unexpected-noindex'
  ) {
    return 'critical';
  }
  if (
    code === 'missing-helmet' ||
    code === 'missing-seo-route' ||
    code === 'orphaned-seo-route'
  ) {
    return 'info';
  }
  if (code.startsWith('aeo-')) {
    return 'warning';
  }
  return 'warning';
}

export type SeoHtmlAuditLayer = 'published' | 'preview';

export type SeoPageAuditLayer = SeoHtmlAuditLayer | 'source';

export type SeoAuditMode = 'published' | 'preview' | 'source-only';

export type SeoPageAudit = {
  path: string;
  url?: string;
  layer: SeoPageAuditLayer;
  ok: boolean;
  issues: SeoAuditIssue[];
};

export type SeoAuditReport = {
  appId: string;
  auditedAt: string;
  /** URL used for HTML route fetches (published or preview). */
  htmlBaseUrl: string | null;
  auditMode: SeoAuditMode;
  /** @deprecated Use htmlBaseUrl — kept for older cached reports. */
  publishedBaseUrl?: string | null;
  routes: string[];
  pages: SeoPageAudit[];
  summary: {
    totalPages: number;
    pagesWithIssues: number;
    issueCount: number;
  };
  /** Business/strategy context from seoAnalysis / runSeoCheck (optional on audit-only runs). */
  strategy?: SeoStrategyContext;
  /** Per-route LLM schema guidance: recommended @types and JSON-LD fields (interactive audit only). */
  schemaAeoByRoute?: Record<string, AeoRouteSchemaGuidance>;
  /** @type values found in live JSON-LD per route (HTML audit). */
  schemaTypesByRoute?: Record<string, string[]>;
};

export type SeoAuditExecutionContext = Pick<ExecutionContext, 'socketId'> & {
  metadata?: Pick<
    ExecutionContextMetadata,
    | 'appId'
    | 'sessionId'
    | 'agentId'
    | 'customerId'
    | 'subscriptionId'
    | 'bmsBudgetId'
    | 'budgetSessionId'
    | 'budgetServiceEnabled'
  >;
};

export type RunSeoAuditParams = {
  appId: string;
  appPath: string;
  publishedUrl?: string | null;
  previewUrl?: string | null;
  /** When false, HTML checks use preview (or source-only), not published_url alone. */
  isPublished?: boolean;
  includeSourceScan?: boolean;
  maxRoutes?: number;
  /** Enables batched LLM schema recommendations when set (skipped for publish hook). */
  executionContext?: SeoAuditExecutionContext;
  strategyContext?: SeoStrategyContext;
  skipSchemaRecommendations?: boolean;
};

export function buildSeoAuditExecutionContext(
  context?: { socketId?: string; metadata?: Record<string, unknown> },
): SeoAuditExecutionContext | undefined {
  const metadata = context?.metadata;
  const appId = typeof metadata?.appId === 'string' ? metadata.appId : undefined;
  const socketId = context?.socketId;
  if (!appId && !socketId) {
    return undefined;
  }

  return {
    ...(socketId && { socketId }),
    metadata: {
      ...(appId && { appId }),
      ...(typeof metadata?.sessionId === 'string' && { sessionId: metadata.sessionId }),
      ...(typeof metadata?.agentId === 'string' && { agentId: metadata.agentId }),
      ...(typeof metadata?.customerId === 'string' && { customerId: metadata.customerId }),
      ...(typeof metadata?.subscriptionId === 'string' && { subscriptionId: metadata.subscriptionId }),
      ...(typeof metadata?.bmsBudgetId === 'string' && { bmsBudgetId: metadata.bmsBudgetId }),
      ...(typeof metadata?.budgetSessionId === 'string' && { budgetSessionId: metadata.budgetSessionId }),
      ...(metadata?.budgetServiceEnabled === true && { budgetServiceEnabled: true }),
    },
  };
}

export function resolveHtmlAuditTarget(
  publishedUrl?: string | null,
  previewUrl?: string | null,
  isPublished = false,
): { baseUrl: string; htmlLayer: SeoHtmlAuditLayer } | null {
  if (isPublished) {
    const published = publishedUrl?.trim();
    if (published) {
      return { baseUrl: published, htmlLayer: 'published' };
    }
    return null;
  }
  const preview = previewUrl?.trim();
  if (preview) {
    return { baseUrl: preview, htmlLayer: 'preview' };
  }
  return null;
}

type ValidatorLogger = {
  warn: (event: string, data: unknown) => void;
  info: (event: string, data: unknown) => void;
};

const DEFAULT_MAX_ROUTES = 20;
const SEO_ROUTES_FILE = join('src', 'lib', 'seo-routes.ts');
const PAGES_DIR = join('src', 'pages');

/** System/error pages — not indexable; excluded from HTML and source audits. */
const SEO_AUDIT_EXCLUDED_ROUTES = new Set(['/404']);

export function isExcludedFromSeoAudit(routePath: string): boolean {
  return SEO_AUDIT_EXCLUDED_ROUTES.has(routePath);
}

const auditCache = new Map<string, { report: SeoAuditReport; expiresAt: number }>();
const CACHE_TTL_MS = 120_000;

function toIssues(codes: string[]): SeoAuditIssue[] {
  return codes.map(code => ({
    code,
    label: labelForSeoCheck(code),
    severity: severityForSeoCheck(code),
  }));
}

function pageAudit(
  path: string,
  layer: SeoPageAudit['layer'],
  codes: string[],
  url?: string,
): SeoPageAudit {
  const issues = toIssues(codes);
  return {
    path,
    url,
    layer,
    ok: issues.length === 0,
    issues,
  };
}

/** Parse `path: "/foo"` entries from src/lib/seo-routes.ts */
export function parseSeoRoutePaths(seoRoutesFileContent: string): string[] {
  const paths = new Set<string>();
  const re = /path:\s*['"]([^'"]+)['"]/g;
  for (const match of seoRoutesFileContent.matchAll(re)) {
    const p = match[1];
    if (p?.startsWith('/')) {
      paths.add(p);
    }
  }
  if (paths.size === 0) {
    paths.add('/');
  }
  return [...paths].sort();
}

export function discoverSeoRoutes(appPath: string): string[] {
  const routesFile = join(appPath, SEO_ROUTES_FILE);
  if (!existsSync(routesFile)) {
    return ['/'];
  }
  try {
    const content = readFileSync(routesFile, 'utf8');
    return parseSeoRoutePaths(content);
  } catch {
    return ['/'];
  }
}

/** Routes inferred from `src/pages` (excludes system pages like `/404`). */
export function discoverPageRoutes(appPath: string): string[] {
  const paths = new Set<string>();
  for (const file of listPageSourceFiles(appPath)) {
    const routePath = sourcePathToRoute(file, appPath);
    if (!isExcludedFromSeoAudit(routePath)) {
      paths.add(routePath);
    }
  }
  return [...paths].sort();
}

/** Union of seo-routes registry paths and page file paths — used for HTML audit. */
export function discoverAllAuditableRoutes(appPath: string, maxRoutes = DEFAULT_MAX_ROUTES): string[] {
  const combined = new Set<string>();
  for (const routePath of discoverSeoRoutes(appPath)) {
    if (!isExcludedFromSeoAudit(routePath)) {
      combined.add(routePath);
    }
  }
  for (const routePath of discoverPageRoutes(appPath)) {
    combined.add(routePath);
  }
  return [...combined].sort().slice(0, maxRoutes);
}

function applyRegistryIssueIfNeeded(
  page: SeoPageAudit,
  routePath: string,
  pageRoutes: Set<string>,
  registeredSeoRoutes: Set<string>,
): void {
  if (!pageRoutes.has(routePath)) {
    return;
  }
  if (registeredSeoRoutes.size === 0 || registeredSeoRoutes.has(routePath)) {
    return;
  }
  if (page.issues.some(issue => issue.code === 'missing-seo-route')) {
    return;
  }
  page.issues.push(...toIssues(['missing-seo-route']));
  page.ok = page.issues.length === 0;
}

function applyOrphanedRegistryIssues(
  pages: SeoPageAudit[],
  registeredSeoRoutes: Set<string>,
  pageRoutes: Set<string>,
): void {
  if (pageRoutes.size === 0 || registeredSeoRoutes.size === 0) {
    return;
  }

  for (const routePath of registeredSeoRoutes) {
    if (pageRoutes.has(routePath) || isExcludedFromSeoAudit(routePath)) {
      continue;
    }

    const existing = pages.find(page => page.path === routePath);
    if (existing) {
      if (existing.issues.some(issue => issue.code === 'orphaned-seo-route')) {
        continue;
      }
      existing.issues.push(...toIssues(['orphaned-seo-route']));
      existing.ok = existing.issues.length === 0;
      continue;
    }

    pages.push(pageAudit(routePath, 'source', ['orphaned-seo-route']));
  }
}

function mergeSourceIssuesIntoPage(existing: SeoPageAudit, sourceAudit: SeoPageAudit, htmlLayer?: SeoHtmlAuditLayer): void {
  const merged = new Map<string, SeoAuditIssue>();
  for (const issue of [...existing.issues, ...sourceAudit.issues]) {
    merged.set(issue.code, issue);
  }
  existing.issues = [...merged.values()];
  existing.ok = existing.issues.length === 0;
  if (htmlLayer) {
    existing.layer = htmlLayer;
  }
}

export function buildPublishedPageUrl(baseUrl: string, routePath: string): string {
  const parsed = new URL(baseUrl);
  if (routePath === '/') {
    const href = parsed.href;
    return href.endsWith('/') && !href.endsWith('://') ? href.replace(/\/$/, '') || href : href;
  }
  const basePath = parsed.pathname.replace(/\/$/, '') || '';
  const route = routePath.startsWith('/') ? routePath : `/${routePath}`;
  parsed.pathname = `${basePath}${route}`.replace(/\/{2,}/g, '/') || '/';
  return parsed.href;
}

export async function auditHtmlRoute(
  baseUrl: string,
  routePath: string,
  htmlLayer: SeoHtmlAuditLayer,
  recommendedTypes?: string[],
): Promise<SeoPageAudit> {
  const url = buildPublishedPageUrl(baseUrl, routePath);
  const fetched = await fetchPublishedPageHtml(url);
  if (!fetched.ok) {
    return pageAudit(routePath, htmlLayer, [`fetch failed: ${fetched.detail}`], url);
  }
  return auditHtmlContent(fetched.html, routePath, htmlLayer, url, recommendedTypes);
}

export function auditHtmlContent(
  html: string,
  routePath: string,
  htmlLayer: SeoHtmlAuditLayer,
  url: string,
  recommendedTypes?: string[],
): SeoPageAudit {
  const codes = [
    ...runSeoHtmlChecks(html),
    ...runAeoStructureChecks(html, routePath, {
      pageUrl: url,
      validateAgainstScannedUrl: htmlLayer === 'published',
    }),
  ];
  return pageAudit(routePath, htmlLayer, codes, url);
}

/** @deprecated Use auditHtmlRoute */
export const auditPublishedRoute = auditHtmlRoute;

function listPageSourceFiles(appPath: string): string[] {
  const root = join(appPath, PAGES_DIR);
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(tsx|jsx)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function sourcePathToRoute(filePath: string, appPath: string): string {
  const rel = relative(join(appPath, PAGES_DIR), filePath).replace(/\\/g, '/');
  if (rel === '_404.tsx' || rel === '_404.jsx' || rel === '404.tsx' || rel === '404.jsx') {
    return '/404';
  }
  if (rel === 'index.tsx' || rel === 'index.jsx') {
    return '/';
  }
  const withoutExt = rel.replace(/\.(tsx|jsx)$/, '');
  if (withoutExt.endsWith('/index')) {
    return `/${withoutExt.slice(0, -'/index'.length)}`;
  }
  return `/${withoutExt}`;
}

function auditSourceFile(filePath: string, appPath: string, registeredRoutes: Set<string>): SeoPageAudit {
  const routePath = sourcePathToRoute(filePath, appPath);
  const content = readFileSync(filePath, 'utf8');
  const codes: string[] = [];

  const hasHelmet =
    /\bHelmet\b/.test(content) ||
    /from\s+['"]@dr\.pogodin\/react-helmet['"]/.test(content) ||
    /<title[\s>]/.test(content);

  if (!hasHelmet) {
    codes.push('missing-helmet');
  }

  // Use shared source checks so source-scan and edit-time gate stay in sync.
  for (const check of SEO_SOURCE_CHECKS) {
    if (check.blocking && !check.test(content)) {
      codes.push(`missing-${check.name}`);
    }
  }

  if (registeredRoutes.size > 0 && !registeredRoutes.has(routePath)) {
    codes.push('missing-seo-route');
  }

  return pageAudit(routePath, 'source', codes);
}

export async function runSeoAudit(params: RunSeoAuditParams): Promise<SeoAuditReport> {
  const {
    appId,
    appPath,
    publishedUrl = null,
    previewUrl = null,
    isPublished = false,
    includeSourceScan = true,
    maxRoutes = DEFAULT_MAX_ROUTES,
    executionContext,
    strategyContext,
    skipSchemaRecommendations = false,
  } = params;

  const registeredSeoRoutes = new Set(
    discoverSeoRoutes(appPath).filter(routePath => !isExcludedFromSeoAudit(routePath)),
  );
  const pageRoutes = new Set(discoverPageRoutes(appPath));
  const routes = discoverAllAuditableRoutes(appPath, maxRoutes);
  const pages: SeoPageAudit[] = [];

  const htmlTarget = resolveHtmlAuditTarget(publishedUrl, previewUrl, isPublished);
  const auditMode: SeoAuditMode = htmlTarget
    ? htmlTarget.htmlLayer
    : 'source-only';

  let schemaAeoByRoute: Record<string, AeoRouteSchemaGuidance> | undefined;
  let schemaTypesByRoute: Record<string, string[]> | undefined;

  if (htmlTarget) {
    type FetchedRoute = { routePath: string; html: string; url: string };
    const fetchedRoutes: FetchedRoute[] = [];
    const schemaTypesByRouteAccum: Record<string, string[]> = {};

    for (const routePath of routes) {
      const url = buildPublishedPageUrl(htmlTarget.baseUrl, routePath);
      const fetched = await fetchPublishedPageHtml(url);
      if (!fetched.ok) {
        const page = pageAudit(routePath, htmlTarget.htmlLayer, [`fetch failed: ${fetched.detail}`], url);
        applyRegistryIssueIfNeeded(page, routePath, pageRoutes, registeredSeoRoutes);
        pages.push(page);
        continue;
      }
      fetchedRoutes.push({ routePath, html: fetched.html, url });
    }

    const shouldRecommend =
      !skipSchemaRecommendations &&
      executionContext !== undefined &&
      fetchedRoutes.length > 0;

    if (shouldRecommend) {
      const recommendations = await recommendAeoSchemaTypes({
        routes: fetchedRoutes.map(({ routePath, html }) => extractRoutePageSignals(html, routePath)),
        strategy: strategyContext,
        executionContext,
      });
      if (recommendations && Object.keys(recommendations).length > 0) {
        schemaAeoByRoute = recommendations;
      }
    }

    for (const { routePath, html, url } of fetchedRoutes) {
      if (schemaAeoByRoute?.[routePath]) {
        schemaTypesByRouteAccum[routePath] = extractSchemaTypesFromHtml(html);
      }
      const page = auditHtmlContent(
        html,
        routePath,
        htmlTarget.htmlLayer,
        url,
        schemaAeoByRoute?.[routePath]?.types,
      );
      applyRegistryIssueIfNeeded(page, routePath, pageRoutes, registeredSeoRoutes);
      pages.push(page);
    }

    if (Object.keys(schemaTypesByRouteAccum).length > 0) {
      schemaTypesByRoute = schemaTypesByRouteAccum;
    }
  }

  const htmlLayerForMerge = htmlTarget?.htmlLayer;

  if (includeSourceScan) {
    const seenSource = new Set(pages.map(p => p.path));
    for (const file of listPageSourceFiles(appPath)) {
      const audit = auditSourceFile(file, appPath, registeredSeoRoutes);
      if (isExcludedFromSeoAudit(audit.path)) {
        continue;
      }
      if (!seenSource.has(audit.path)) {
        pages.push(audit);
        seenSource.add(audit.path);
      } else if (audit.issues.length > 0) {
        const existing = pages.find(p => p.path === audit.path);
        if (existing) {
          mergeSourceIssuesIntoPage(existing, audit, htmlLayerForMerge);
        }
      }
    }
  }

  applyOrphanedRegistryIssues(pages, registeredSeoRoutes, pageRoutes);

  const pagesWithIssues = pages.filter(p => !p.ok).length;
  const issueCount = pages.reduce((n, p) => n + p.issues.length, 0);
  const htmlBaseUrl = htmlTarget?.baseUrl ?? null;

  return {
    appId,
    auditedAt: new Date().toISOString(),
    htmlBaseUrl,
    auditMode,
    publishedBaseUrl: auditMode === 'published' ? htmlBaseUrl : null,
    routes,
    pages,
    summary: {
      totalPages: pages.length,
      pagesWithIssues,
      issueCount,
    },
    ...(schemaAeoByRoute && { schemaAeoByRoute }),
    ...(schemaTypesByRoute && { schemaTypesByRoute }),
  };
}

export function formatSeoAuditSummary(report: SeoAuditReport): string {
  const { summary, auditMode } = report;
  const lines = [
    `SEO audit: ${summary.issueCount} issue(s) across ${summary.pagesWithIssues}/${summary.totalPages} page(s).`,
  ];
  if (auditMode === 'published') {
    lines.push('HTML checks ran against the published site.');
  } else if (auditMode === 'preview') {
    lines.push('HTML checks ran against preview. Publish to verify the live site.');
  } else if (auditMode === 'source-only') {
    lines.push('Preview/publish unreachable — only source code checks (Helmet + seo-routes).');
  }
  for (const page of report.pages.filter(p => !p.ok).slice(0, 8)) {
    const labels = page.issues.map(i => i.label).join('; ');
    lines.push(`- ${page.path}: ${labels}`);
  }
  if (report.pages.filter(p => !p.ok).length > 8) {
    lines.push('- …additional pages omitted');
  }
  return lines.join('\n');
}

export type SeoAuditCacheLookup = Pick<
  RunSeoAuditParams,
  'appId' | 'publishedUrl' | 'previewUrl' | 'isPublished' | 'includeSourceScan'
>;

export function buildSeoAuditCacheKey(lookup: SeoAuditCacheLookup): string {
  const htmlTarget = resolveHtmlAuditTarget(
    lookup.publishedUrl,
    lookup.previewUrl,
    lookup.isPublished ?? false,
  );
  const auditMode: SeoAuditMode = htmlTarget ? htmlTarget.htmlLayer : 'source-only';
  const htmlBase = htmlTarget?.baseUrl ?? '';
  const includeSource = lookup.includeSourceScan !== false ? '1' : '0';
  return `${lookup.appId}|${auditMode}|${htmlBase}|${includeSource}`;
}

export function cacheSeoAuditReport(report: SeoAuditReport, lookup: SeoAuditCacheLookup): void {
  auditCache.set(buildSeoAuditCacheKey(lookup), {
    report,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function getCachedSeoAuditReport(lookup: SeoAuditCacheLookup): SeoAuditReport | null {
  const key = buildSeoAuditCacheKey(lookup);
  const entry = auditCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    auditCache.delete(key);
    return null;
  }
  return entry.report;
}

export async function runAndCacheSeoAudit(params: RunSeoAuditParams): Promise<SeoAuditReport> {
  const report = await runSeoAudit(params);
  cacheSeoAuditReport(report, params);
  return report;
}

export type RunSeoCheckParams = RunSeoAuditParams & {
  strategyInput?: SeoStrategyInput;
  appDisplayName?: string | null;
  useCachedAudit?: boolean;
};

/** Strategy context + technical audit (used by seoAnalysis). */
export async function runSeoCheck(params: RunSeoCheckParams): Promise<SeoAuditReport> {
  const strategy = buildSeoStrategyContext(params.strategyInput ?? {}, {
    appName: params.appDisplayName,
  });

  const {
    strategyInput: _s,
    appDisplayName: _a,
    useCachedAudit: _u,
    executionContext,
    ...auditParams
  } = params;

  let report: SeoAuditReport | null =
    params.useCachedAudit !== false ? getCachedSeoAuditReport(auditParams) : null;

  if (!report) {
    report = await runAndCacheSeoAudit({
      ...auditParams,
      executionContext,
      strategyContext: strategy,
    });
  }

  const merged: SeoAuditReport = { ...report, strategy };
  cacheSeoAuditReport(merged, auditParams);
  return merged;
}

/** Log-only multi-route validation for publish (reuses audit, logs per page). */
export function logSeoAuditReport(
  appId: string,
  report: SeoAuditReport,
  logger: ValidatorLogger,
): void {
  for (const page of report.pages) {
    if (page.ok) {
      logger.info('seo.validation.result', {
        appId,
        path: page.path,
        url: page.url,
        ok: true,
        warningCount: 0,
      });
      continue;
    }
    for (const issue of page.issues) {
      logger.warn('seo.validation.missing', {
        appId,
        path: page.path,
        url: page.url,
        check: issue.code,
      });
    }
    logger.warn('seo.validation.result', {
      appId,
      path: page.path,
      url: page.url,
      ok: false,
      warningCount: page.issues.length,
    });
  }

  logger.info('seo.validation.audit-complete', {
    appId,
    routeCount: report.routes.length,
    pagesWithIssues: report.summary.pagesWithIssues,
    issueCount: report.summary.issueCount,
  });
}

export async function logPublishedSeoAudit(
  appId: string,
  appPath: string,
  publishedUrl: string,
  logger: ValidatorLogger,
): Promise<void> {
  const report = await runSeoAudit({
    appId,
    appPath,
    publishedUrl,
    isPublished: true,
    includeSourceScan: false,
  });
  logSeoAuditReport(appId, report, logger);
}

export function seoCheckResultFromPage(page: SeoPageAudit): SeoCheckResult {
  if (page.ok) {
    return { ok: true, warnings: [] };
  }
  const warnings = page.issues.map(i => i.code) as [string, ...string[]];
  return { ok: false, warnings };
}
