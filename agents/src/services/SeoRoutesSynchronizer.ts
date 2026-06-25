import { parse } from '@babel/parser';
import * as t from '@babel/types';

import { isDevSupervisorNotFound } from './DevSupervisorClient.js';
import type { CreateForWorkspace } from '../workspace/client.js';
import { WorkspaceUnavailableError } from '../workspace/errors.js';
import type { WorkspaceFiles } from '../workspace/files.js';
import { createForWorkspace } from '../workspace/index.js';

/** Workspace-relative path of the v8 route registry the agent edits. */
const ROUTES_PATH = 'src/routes.tsx';
/** Workspace-relative path of the generated SEO sitemap registry. */
const SEO_ROUTES_PATH = 'src/lib/seo-routes.ts';

export type SeoRouteChangefreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface SeoRoute {
  path: string;
  changefreq?: SeoRouteChangefreq;
  priority?: number;
  lastmod?: string;
}

export type SeoRoutesSyncResult =
  | {
      status: 'synced';
      /** Workspace-relative path of the written registry (not an absolute host path). */
      filePath: string;
      routes: SeoRoute[];
      warnings: string[];
    }
  | {
      status: 'skipped';
      reason: string;
      routes: [];
      warnings: string[];
    };

interface RoutesArrayResult {
  array: t.ArrayExpression | null;
  reason: string | null;
}

export interface SeoRoutesSyncDeps {
  /** Override the workspace binding (tests inject an in-memory client). */
  workspaceFactory?: CreateForWorkspace;
}

const CHANGEFREQ_VALUES = new Set<SeoRouteChangefreq>([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
]);

function parseModule(source: string): t.File {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
}

function isRoutesIdentifier(node: t.LVal | t.PatternLike): boolean {
  return t.isIdentifier(node) && node.name === 'routes';
}

function getRoutesArray(ast: t.File): RoutesArrayResult {
  // The v8 template declares routes as `export const routes = [...]`. We only
  // sync when that exact shape is present; anything else (factory call, local
  // binding re-exported via `export { routes }`) is left for the agent to fix.
  for (const statement of ast.program.body) {
    if (!t.isExportNamedDeclaration(statement)) continue;
    if (!t.isVariableDeclaration(statement.declaration)) continue;

    for (const declaration of statement.declaration.declarations) {
      if (!isRoutesIdentifier(declaration.id)) continue;
      if (t.isArrayExpression(declaration.init)) {
        return { array: declaration.init, reason: null };
      }
      return { array: null, reason: 'routes export is not a literal array' };
    }
  }

  return { array: null, reason: 'routes export not found' };
}

function getObjectProperty(object: t.ObjectExpression, keyName: string): t.ObjectProperty | null {
  for (const property of object.properties) {
    if (!t.isObjectProperty(property)) continue;
    if (t.isIdentifier(property.key) && property.key.name === keyName) return property;
    if (t.isStringLiteral(property.key) && property.key.value === keyName) return property;
  }
  return null;
}

function stringValue(node: t.Node | null | undefined): string | null {
  return t.isStringLiteral(node) ? node.value : null;
}

function numberValue(node: t.Node | null | undefined): number | null {
  return t.isNumericLiteral(node) ? node.value : null;
}

function joinRoutePath(parentPath: string, routePath: string): string {
  if (routePath.startsWith('/')) return routePath;
  if (!parentPath || parentPath === '/') return `/${routePath}`;
  return `${parentPath.replace(/\/+$/, '')}/${routePath}`;
}

function normalizeRoutePath(parentPath: string, routePath: string): string | null {
  const trimmed = routePath.trim();
  if (!trimmed) return null;
  // Drop catch-all and dynamic-param routes — not statically crawlable.
  if (trimmed.includes('*') || trimmed.includes(':')) return null;

  // joinRoutePath always yields a leading-slash path, so no further guard.
  const joined = joinRoutePath(parentPath, trimmed).replace(/\/+/g, '/');
  return joined === '/' ? joined : joined.replace(/\/+$/, '');
}

function collectRoutePaths(array: t.ArrayExpression, parentPath = ''): string[] {
  const paths: string[] = [];

  for (const element of array.elements) {
    if (!t.isObjectExpression(element)) continue;

    const path = normalizeRoutePath(
      parentPath,
      stringValue(getObjectProperty(element, 'path')?.value) ?? '',
    );

    if (path) paths.push(path);

    const children = getObjectProperty(element, 'children')?.value;
    if (t.isArrayExpression(children)) {
      paths.push(...collectRoutePaths(children, path ?? parentPath));
    }
  }

  return paths;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function defaultMetadata(path: string): Omit<SeoRoute, 'path'> {
  if (path === '/') {
    return { changefreq: 'weekly', priority: 1.0 };
  }

  return {
    changefreq: 'monthly',
    priority: path.split('/').filter(Boolean).length === 1 ? 0.8 : 0.5,
  };
}

// Matches sitemap.org-accepted ISO-8601 forms: YYYY-MM-DD or full date-time
// with optional fractional seconds and a Z / ±HH:MM offset.
const LASTMOD_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isValidLastmod(value: string): boolean {
  if (!LASTMOD_PATTERN.test(value)) return false;
  // Reject values that pass the regex but are calendar-invalid (e.g. 2026-13-99).
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function clampPriority(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readSeoRouteMetadata(object: t.ObjectExpression): SeoRoute | null {
  const path = stringValue(getObjectProperty(object, 'path')?.value);
  if (!path) return null;

  const route: SeoRoute = { path };
  const changefreq = stringValue(getObjectProperty(object, 'changefreq')?.value);
  const priority = numberValue(getObjectProperty(object, 'priority')?.value);
  const lastmod = stringValue(getObjectProperty(object, 'lastmod')?.value);

  if (changefreq && CHANGEFREQ_VALUES.has(changefreq as SeoRouteChangefreq)) {
    route.changefreq = changefreq as SeoRouteChangefreq;
  }
  // Clamp customer-edited priority into the spec-valid [0.0, 1.0] band rather
  // than letting an out-of-range value round-trip into the sitemap.
  if (priority !== null) route.priority = clampPriority(priority);
  // Drop malformed lastmod silently — better to omit than to ship a value
  // crawlers will reject (and that may invalidate the whole sitemap entry).
  if (lastmod && isValidLastmod(lastmod)) route.lastmod = lastmod;

  return route;
}

function readSeoRoutes(source: string): SeoRoute[] {
  const ast = parseModule(source);
  const result = getExportedSeoRoutesArray(ast);
  if (!result) return [];

  return result.elements.flatMap((element) => {
    if (!t.isObjectExpression(element)) return [];
    return readSeoRouteMetadata(element) ?? [];
  });
}

function getExportedSeoRoutesArray(ast: t.File): t.ArrayExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExportNamedDeclaration(statement)) continue;
    if (!t.isVariableDeclaration(statement.declaration)) continue;

    for (const declaration of statement.declaration.declarations) {
      if (
        t.isIdentifier(declaration.id) &&
        declaration.id.name === 'seoRoutes' &&
        t.isArrayExpression(declaration.init)
      ) {
        return declaration.init;
      }
    }
  }

  return null;
}

async function readExistingMetadata(files: WorkspaceFiles): Promise<{
  metadata: Map<string, SeoRoute>;
  warnings: string[];
}> {
  let source: string;
  try {
    const result = await files.view({ path: SEO_ROUTES_PATH });
    source = result.content;
  } catch (error) {
    // First sync (no registry yet) is the only swallowed case. Any other
    // transport failure propagates rather than silently dropping metadata.
    if (isDevSupervisorNotFound(error)) {
      return { metadata: new Map(), warnings: [] };
    }
    throw error;
  }

  // Parse failure separated from read failure so a malformed customer-edited
  // seo-routes.ts is debuggable from the warning text alone.
  try {
    return {
      metadata: new Map(readSeoRoutes(source).map((route) => [route.path, route])),
      warnings: [],
    };
  } catch (error) {
    return {
      metadata: new Map(),
      warnings: [`could not parse existing seo-routes.ts: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function buildRoutes(paths: string[], existingMetadata: Map<string, SeoRoute>): SeoRoute[] {
  return paths.map((path) => ({
    path,
    ...defaultMetadata(path),
    ...existingMetadata.get(path),
  }));
}

function renderPriority(priority: number): string {
  return Number.isInteger(priority) ? priority.toFixed(1) : String(priority);
}

function renderRoute(route: SeoRoute): string {
  const parts = [`path: ${JSON.stringify(route.path)}`];
  if (route.changefreq) parts.push(`changefreq: ${JSON.stringify(route.changefreq)}`);
  if (route.priority !== undefined) parts.push(`priority: ${renderPriority(route.priority)}`);
  if (route.lastmod) parts.push(`lastmod: ${JSON.stringify(route.lastmod)}`);
  return `  { ${parts.join(', ')} },`;
}

function renderSeoRoutes(routes: SeoRoute[]): string {
  return `/**
 * Auto-synced registry of publicly-crawlable routes. Consumed by the
 * /sitemap.xml handler in src/server/entry.ts.
 *
 * DO NOT add or remove paths by hand. Static paths are mirrored here from
 * src/routes.tsx automatically whenever that file is edited (any manual
 * path edit would be overwritten on the next routes.tsx change). For sync
 * to pick up a route, its \`path\` must be a literal string starting with "/";
 * template literals and identifier refs are skipped, and dynamic-param routes
 * like "/products/:id" are excluded.
 *
 * The only fields safe to hand-edit are the per-entry metadata below, after a
 * sync:
 * - \`priority\` (0.0–1.0): Home = 1.0, main sections = 0.8, deep pages = 0.5.
 * - \`changefreq\` and \`lastmod\`.
 */

export interface SeoRoute {
  path: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
  lastmod?: string;
}

export const seoRoutes: SeoRoute[] = [
${routes.map(renderRoute).join('\n')}
];
`;
}

export async function synchronizeSeoRoutes(
  appId: string,
  deps: SeoRoutesSyncDeps = {},
): Promise<SeoRoutesSyncResult> {
  const workspaceFactory: CreateForWorkspace = deps.workspaceFactory ?? createForWorkspace;
  const workspace = workspaceFactory(appId, 'preview');
  if (!workspace) {
    throw new WorkspaceUnavailableError(appId, 'preview');
  }
  const files: WorkspaceFiles = workspace.files;

  let source: string;
  try {
    const result = await files.view({ path: ROUTES_PATH });
    source = result.content;
  } catch (error) {
    // A missing routes.tsx is a legitimate skip; any other transport failure
    // propagates so it is not masked as a benign skip.
    if (isDevSupervisorNotFound(error)) {
      return {
        status: 'skipped',
        reason: 'could not read routes.tsx: not found',
        routes: [],
        warnings: [],
      };
    }
    throw error;
  }

  let ast: t.File;
  try {
    ast = parseModule(source);
  } catch (error) {
    return {
      status: 'skipped',
      reason: `could not parse routes.tsx: ${error instanceof Error ? error.message : String(error)}`,
      routes: [],
      warnings: [],
    };
  }

  const routesArray = getRoutesArray(ast);
  if (!routesArray.array) {
    return {
      status: 'skipped',
      reason: routesArray.reason ?? 'routes export not found',
      routes: [],
      warnings: [],
    };
  }

  const paths = uniquePaths(collectRoutePaths(routesArray.array));
  const { metadata, warnings } = await readExistingMetadata(files);

  // Refuse to overwrite an existing curated seo-routes.ts with an empty array.
  // This guards against transient routes.tsx states (mid-edit, all-non-literal
  // path values, template literals) where parse succeeds but yields no paths —
  // writing [] would silently drop the user's priority/changefreq/lastmod.
  if (paths.length === 0 && metadata.size > 0) {
    return {
      status: 'skipped',
      reason: 'no static routes parsed from routes.tsx; preserving existing seo-routes.ts to avoid wiping curated metadata',
      routes: [],
      warnings,
    };
  }

  const routes = buildRoutes(paths, metadata);

  // workspace.files.write creates parent dirs and writes atomically
  // (tmp + same-dir rename) server-side, so no client-side mkdir is needed.
  await files.write({ path: SEO_ROUTES_PATH, content: renderSeoRoutes(routes) });

  return {
    status: 'synced',
    filePath: SEO_ROUTES_PATH,
    routes,
    warnings,
  };
}
