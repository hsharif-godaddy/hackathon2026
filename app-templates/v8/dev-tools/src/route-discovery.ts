/**
 * Resolve which route the preview iframe should land on after a git checkout.
 *
 * The agents server picks a `pageHint` by looking at which `src/pages/*.tsx`
 * file received the largest diff in the target commit. That heuristic
 * misses when a skill (or any other code path) registers a page at a
 * non-filename route — e.g. `commerce/ui` mounts `Catalog.tsx` at
 * `/shop`, not `/Catalog`. Acting on the bare hint would push the iframe to
 * `/Catalog`, which 404s.
 *
 * This module discovers the app's actual route registry at runtime and
 * resolves a `(url, modulePath)` hint against it. We stay inside dev-tools
 * because changes to the rest of the v8 template are out of scope.
 *
 * Two information sources, both best-effort:
 *
 *   1. The text of `/src/routes.tsx` (fetched via Vite's `?raw` query in dev),
 *      parsed for `path: '...'` literals + nearby `import('...')` targets.
 *      Lets us map source modules → registered route paths.
 *
 *   2. `import.meta.glob('/src/pages/**')` to enumerate page files that exist.
 *      Used to verify a heuristic hint corresponds to a real file before
 *      applying it.
 *
 * Either probe can fail (no `/src/routes.tsx`, glob empty, fetch error). When
 * a tier returns nothing the next tier runs; if everything fails we surface
 * the server hint as-is so we never *block* a working hint just because the
 * registry probe broke.
 */

interface RouteEntry {
  /** Registered route path, e.g. '/', '/about', '/shop', '/blog/:slug'. */
  path: string;
  /**
   * Source file the route maps to (when extractable), normalized to
   * `src/pages/foo.tsx` form. `null` for routes whose element couldn't be
   * traced back to a single file (e.g. inline JSX, complex composition).
   */
  modulePath: string | null;
}

interface RouteManifest {
  /** Registered routes, in order they appear in routes.tsx. May be empty if discovery failed. */
  routes: RouteEntry[];
  /** Module paths under /src/pages that exist on disk, normalized (e.g. `src/pages/about.tsx`). */
  pageFiles: Set<string>;
  builtAt: number;
}

let cached: RouteManifest | null = null;
let inflight: Promise<RouteManifest> | null = null;

export async function discoverRoutes(): Promise<RouteManifest> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const [routes, pageFiles] = await Promise.all([
      fetchRoutesText(),
      enumeratePageFiles(),
    ]);
    const manifest: RouteManifest = { routes, pageFiles, builtAt: Date.now() };
    cached = manifest;
    inflight = null;
    return manifest;
  })().catch((error: unknown) => {
    // Reset so the next caller can retry. Returning an empty manifest keeps
    // resolveRouteForModule's "trust the server hint" fallback path live.
    inflight = null;
    cached = null;
    throw error;
  });

  return inflight;
}

function invalidate(): void {
  cached = null;
  inflight = null;
}

// HMR can register or remove routes, so flush the cache on every update.
// Wrapping in a try/catch lets non-Vite environments (tests) import this
// module without exploding on the missing `import.meta.hot`.
try {
  if (typeof import.meta !== 'undefined' && import.meta.hot) {
    import.meta.hot.on('vite:beforeUpdate', invalidate);
    import.meta.hot.on('vite:beforeFullReload', invalidate);
  }
} catch {
  // Non-Vite environment; nothing to wire up.
}

async function fetchRoutesText(): Promise<RouteEntry[]> {
  try {
    const res = await fetch('/src/routes.tsx?raw', { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return parseRoutesText(text);
  } catch {
    return [];
  }
}

/**
 * Walk the routes.tsx text looking for `path: '<X>'` literals and try to
 * associate each path with the source module backing its `element`. Two-pass:
 *
 *   1. Build a map of `<Identifier> → src/pages/...` from top-level
 *      declarations like `const Foo = lazy(() => import('./pages/Foo'))` or
 *      `const Foo = () => import('./pages/Foo')`.
 *   2. For each `path: '...'` literal, look ahead a short window for
 *      `element: <Identifier ...` and resolve via the map.
 *
 * Falls back to inline `import('...')` calls inside the same window when no
 * variable mapping exists. This is a regex sketch, not a real parser — it
 * handles the common React Router v6 shapes used by the v8 template and
 * skill-installed pages.
 */
export function parseRoutesText(source: string): RouteEntry[] {
  const nameToModule = collectImportBindings(source);
  const entries: RouteEntry[] = [];
  const pathRegex = /path\s*:\s*(['"`])([^'"`]*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(source)) !== null) {
    const path = match[2] ?? '';
    const lookaheadEnd = Math.min(source.length, match.index + 400);
    const lookahead = source.slice(match.index, lookaheadEnd);
    const modulePath =
      resolveElementModule(lookahead, nameToModule) ??
      extractInlineModulePath(lookahead);
    entries.push({ path, modulePath });
  }
  return entries;
}

/**
 * Scan top-level `const Foo = ... import('./pages/Foo')` patterns and return
 * a map of identifier → normalized module path. Both `lazy(() => import(...))`
 * and bare `() => import(...)` shapes are accepted.
 */
function collectImportBindings(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const bindingRegex =
    /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*[^;]*?import\s*\(\s*(['"`])([^'"`]+)\2/g;
  let m: RegExpExecArray | null;
  while ((m = bindingRegex.exec(source)) !== null) {
    const name = m[1];
    const spec = m[3];
    if (name && spec) map.set(name, normalizeImport(spec));
  }
  return map;
}

function resolveElementModule(
  snippet: string,
  nameToModule: Map<string, string>,
): string | null {
  const elementRegex = /element\s*:\s*<\s*([A-Za-z_$][A-Za-z0-9_$]*)/;
  const m = elementRegex.exec(snippet);
  if (!m || !m[1]) return null;
  return nameToModule.get(m[1]) ?? null;
}

function extractInlineModulePath(snippet: string): string | null {
  const importRegex = /import\s*\(\s*(['"`])([^'"`]+)\1/;
  const m = importRegex.exec(snippet);
  return m && m[2] ? normalizeImport(m[2]) : null;
}

/**
 * Normalize an import specifier from routes.tsx into a `src/pages/...` path
 * we can compare against the server's `modulePath`. Handles:
 *   './pages/Catalog'      → src/pages/Catalog.tsx
 *   '../pages/Catalog.tsx' → src/pages/Catalog.tsx
 *   '@/pages/Catalog'      → src/pages/Catalog.tsx  (v8 alias)
 *   '/src/pages/Catalog'   → src/pages/Catalog.tsx
 */
export function normalizeImport(importSpec: string): string {
  let p = importSpec.trim();
  p = p.replace(/^\//, '');
  p = p.replace(/^\.\//, '');
  p = p.replace(/^@\//, 'src/');
  p = p.replace(/^\.\.\//, '');
  if (p.startsWith('pages/')) p = 'src/' + p;
  if (!/\.(tsx|ts|jsx|js)$/.test(p)) p = p + '.tsx';
  return p;
}

async function enumeratePageFiles(): Promise<Set<string>> {
  try {
    // `import.meta.glob` is resolved at build time by Vite. The argument
    // must be a literal string; the glob is rooted at the Vite project root,
    // which (for dev-tools loaded via the app's Vite dev server) is the v8
    // template root, so this matches the *consuming app's* pages.
    const modules = (import.meta as unknown as {
      glob?: (pattern: string) => Record<string, unknown>;
    }).glob?.('/src/pages/**/*.{tsx,ts,jsx,js}') ?? {};
    const set = new Set<string>();
    for (const key of Object.keys(modules)) {
      set.add(key.replace(/^\//, ''));
    }
    return set;
  } catch {
    return new Set();
  }
}

/**
 * Resolve the final URL the iframe should navigate to after a git checkout.
 *
 * Strategy (each tier falls back if it returns null):
 *   1. Registry hit by module path — catches skill-installed pages mounted
 *      at non-filename routes.
 *   2. Registry-verified server URL — if the heuristic hint matches a
 *      registered route (or registry probe failed and we have no choice
 *      but to trust it), use it.
 *   3. Null — return null rather than reroute to a fake `/` that may not
 *      exist; caller leaves the iframe at its current path.
 *
 * Never returns the current path (no-op handled by caller).
 */
export async function resolveRouteForModule(
  hint: { url: string | null; modulePath: string | null },
  currentPath: string,
): Promise<string | null> {
  if (!hint.modulePath && !hint.url) return null;

  let manifest: RouteManifest;
  try {
    manifest = await discoverRoutes();
  } catch {
    return hint.url && hint.url !== currentPath ? hint.url : null;
  }

  // Tier 1: registry hit by module path. Wins over the filename heuristic
  // because it reflects how the app is actually wired up at this commit.
  if (hint.modulePath) {
    const norm = hint.modulePath.replace(/^\//, '');
    const registryHit = manifest.routes.find(r => r.modulePath === norm);
    if (registryHit && registryHit.path !== currentPath) {
      return registryHit.path;
    }
  }

  // Tier 2: trust the server's filename hint if the registry confirms it,
  // OR if the registry probe came back empty (we'd rather try the hint than
  // strand the user on the 404).
  if (hint.url) {
    const probeFailed = manifest.routes.length === 0;
    const registered = manifest.routes.some(r => routesMatch(r.path, hint.url!));
    if ((probeFailed || registered) && hint.url !== currentPath) {
      return hint.url;
    }
  }

  return null;
}

/**
 * Match a registered route pattern (`/blog/:slug`) against a candidate path
 * (`/blog/intro`). Catch-all (`*`, `/*`) is intentionally treated as a
 * non-match so we don't claim a path is "registered" when it would only hit
 * the 404 fallback.
 */
export function routesMatch(pattern: string, candidate: string): boolean {
  if (pattern === candidate) return true;
  if (pattern === '*' || pattern === '/*' || pattern.endsWith('/*')) return false;
  const regex = pattern.replace(/:[^/]+/g, '[^/]+');
  try {
    return new RegExp(`^${regex}$`).test(candidate);
  } catch {
    return false;
  }
}

/** Test-only — clears module-level state between cases. */
export function __resetForTests(): void {
  cached = null;
  inflight = null;
}
