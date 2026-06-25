#!/usr/bin/env node

/**
 * RUBICON-373 follow-up — deterministic AST rewriter for src/server/entry.ts.
 *
 * Migrates Shape A (`unconditional_allow`) /robots.txt handlers to Shape D
 * (the canonical `isSystemHost` + `./seo-host` form). No-ops on every other
 * shape (B, C, D, E, unknown, parse_failed, robots_handler_not_found).
 * Gated by REWRITE_ROBOTS_HANDLER=1.
 *
 * /sitemap.xml is intentionally left untouched: we have no hash allowlist
 * or shape classifier for sitemap bodies, and the robots Disallow on system
 * hosts is the load-bearing safety win — well-behaved crawlers never fetch
 * sitemap once robots disallows the host. Tracked separately in RUBICON-XXX.
 *
 * Guarantees:
 *   - Idempotent: re-running classifies as Shape D and exits early.
 *   - Dirty-tree-safe: aborts if `git status --porcelain` reports changes
 *     under src/server/entry.ts or src/server/seo-host.ts so we never
 *     clobber in-flight customer edits.
 *   - Self-verifying: re-reads the written file from disk, re-parses it
 *     and re-classifies; if the post-write shape is anything other than
 *     D (including a truncated/partial write where parsing fails), we
 *     restore the original entry.ts and report failure.
 *
 * Side effects on success:
 *   - src/server/entry.ts:
 *     - replaces /robots.txt handler body with the Shape D body
 *     - inserts `import { isSystemHost } from "./seo-host";` if missing
 *   - src/server/seo-host.ts: written verbatim if missing.
 *
 * The seo-host.ts contents are inlined here as a string constant — the
 * preview container has no access to the agents/ tree, so we cannot
 * runtime-import the canonical template.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import {
  findGetCallExpression,
  generateNodeSrc,
  classifyHandler,
} from './observe-robots-handler.js';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const TELEMETRY_TAG = 'RUBICON-373';

/**
 * Known-buggy robots-handler-body hashes sourced from a 24h Loki query
 * over the prod observer's `unconditional_allow` events:
 *
 *   topk(20, sum by (robotsHandlerHash) (count_over_time(
 *     {job="airo-preview-application"}
 *       |= "observe-robots-handler.completed"
 *       |= "unconditional_allow"
 *     | json | line_format "{{.message}}" | json
 *     [24h]
 *   )))
 *
 * The four hashes below cover ~78% of Shape A events and almost
 * certainly correspond to the canonical pre-RUBICON-373 v8 template
 * body and a few minor formatting variants. Apps whose body hashes
 * outside this Set are treated as "not in allowlist" and skipped — the
 * Shape A classifier uses a loose substring check (Allow + Sitemap)
 * that can false-positive on customer-customized handlers; gating on
 * a known-good hash list eliminates that risk for the rewrite path.
 *
 * Long-tail apps (~22% of Shape A events) get a `not_in_allowlist`
 * skip in telemetry and remain on Shape A until we sample their
 * bodies (via LOG_ROBOTS_HANDLER_BODY=1) and decide whether to extend
 * this list.
 */
const KNOWN_BUGGY_ROBOTS_HASHES = new Set([
  'cd7a158a644d55b760e3bc2c2b4ba4b1',
  '16ce1fab97731a1d9a20a8686060e2f2',
  '4ffe2b6f9269e9693e322858e5908c68',
  '9abe8a277f7681b395a7c70cb787affa',
]);

function md5(s) {
  return createHash('md5').update(s).digest('hex');
}

const SEO_HOST_TS_CONTENTS = `// Traefik routes unknown hosts to nowhere, so any request reaching this
// container that isn't on a system host (preview, published-without-
// custom-domain, dev, localhost) is a customer-attached domain. Customer
// domains get Allow + self-canonical; system hosts get Disallow + noindex.
export const SYSTEM_HOST_SUFFIXES = [
\t".airoapp.ai",
\t".test-airoapp.ai",
\t".dev-airoapp.ai",
\t".dev-godaddy.com",
];

export function isSystemHost(req: { hostname?: string | null }): boolean {
\tconst h = (req.hostname || "").toLowerCase();
\tif (!h || h === "localhost" || h === "127.0.0.1") return true;
\treturn SYSTEM_HOST_SUFFIXES.some(
\t\t(s) => h === s.replace(/^\\./, "") || h.endsWith(s),
\t);
}
`;

const SHAPE_D_ROBOTS_HANDLER = `(req, res) => {
  if (isSystemHost(req)) {
    res
      .type("text/plain")
      .set("Cache-Control", "public, max-age=60, must-revalidate").set("Vary", "Host")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  const base = baseUrl(req);
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    \`Sitemap: \${base}/sitemap.xml\`,
    "",
  ].join("\\n");
  res.type("text/plain").set("Cache-Control", "public, max-age=60, must-revalidate").set("Vary", "Host").send(body);
}`;

function parseSource(source) {
  return babelParse(source, { sourceType: 'module', plugins: ['typescript'] });
}

function parseExpression(source) {
  const wrapped = `const __x = ${source};`;
  const ast = parseSource(wrapped);
  return ast.program.body[0].declarations[0].init;
}

const ROBOTS_BODY_DEPS = ['baseUrl'];

function hasTopLevelIdentifier(ast, name) {
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name === name) return true;
    if (t.isClassDeclaration(stmt) && stmt.id && stmt.id.name === name) return true;
    if (t.isVariableDeclaration(stmt)) {
      for (const decl of stmt.declarations) {
        if (t.isIdentifier(decl.id) && decl.id.name === name) return true;
      }
    }
    if (t.isImportDeclaration(stmt)) {
      for (const spec of stmt.specifiers) {
        if (
          (t.isImportSpecifier(spec) || t.isImportDefaultSpecifier(spec) || t.isImportNamespaceSpecifier(spec)) &&
          spec.local && spec.local.name === name
        ) {
          return true;
        }
      }
    }
    if (t.isExportNamedDeclaration(stmt) && stmt.declaration) {
      const inner = stmt.declaration;
      if (t.isFunctionDeclaration(inner) && inner.id && inner.id.name === name) return true;
      if (t.isClassDeclaration(inner) && inner.id && inner.id.name === name) return true;
      if (t.isVariableDeclaration(inner)) {
        for (const decl of inner.declarations) {
          if (t.isIdentifier(decl.id) && decl.id.name === name) return true;
        }
      }
    }
  }
  return false;
}

function missingDeps(ast, names) {
  return names.filter((n) => !hasTopLevelIdentifier(ast, n));
}

function hasIsSystemHostImport(ast) {
  let found = false;
  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source && path.node.source.value;
      if (src !== './seo-host' && src !== './seo-host.js' && src !== './seo-host.ts') return;
      const hasNamed = path.node.specifiers.some(
        (sp) => t.isImportSpecifier(sp) && t.isIdentifier(sp.imported) && sp.imported.name === 'isSystemHost',
      );
      if (hasNamed) {
        found = true;
        path.stop();
      }
    },
  });
  return found;
}

function findLastImportIndex(ast) {
  const body = ast.program.body;
  let lastImportIdx = -1;
  for (let i = 0; i < body.length; i += 1) {
    if (t.isImportDeclaration(body[i])) lastImportIdx = i;
  }
  return lastImportIdx;
}

function buildIsSystemHostImportSrc() {
  return `import { isSystemHost } from "./seo-host";\n`;
}

function insertImportAfterLast(source, ast) {
  const lastImportIdx = findLastImportIndex(ast);
  const importStmt = buildIsSystemHostImportSrc();
  if (lastImportIdx === -1) {
    return importStmt + source;
  }
  const lastImport = ast.program.body[lastImportIdx];
  const insertAt = lastImport.end;
  return source.slice(0, insertAt) + '\n' + importStmt.replace(/\n$/, '') + source.slice(insertAt);
}

/**
 * Pure rewrite step. Returns one of:
 *   { status: 'parse_failed', error }
 *   { status: 'no_op', reason, missing?, robotsHandlerHash? }
 *   { status: 'rewritten', source, addedImport,
 *                          oldShape, newShape, oldHash, newHash }
 *
 * Dependency contract: the canonical Shape D robots handler body
 * references the v8 template's top-level `baseUrl` helper. If a
 * customer's entry.ts has been pruned and lacks `baseUrl` we cannot
 * safely substitute the body — return no_op with reason
 * `missing_robots_deps`.
 *
 * Hash allowlist contract: the Shape A classifier is a loose substring
 * match (Allow + Sitemap) — fine for telemetry counting, too loose for
 * the rewrite path. We additionally gate on the body's md5 matching
 * `KNOWN_BUGGY_ROBOTS_HASHES`. Customer-customized handlers that
 * happen to include both substrings hash outside the allowlist and
 * skip with reason `not_in_allowlist`. Tests can pass
 * `options.allowlist = null` to bypass gating.
 *
 * /sitemap.xml is intentionally NOT rewritten here — see file header.
 */
export function rewriteEntryTs(source, options = {}) {
  const allowlist = 'allowlist' in options ? options.allowlist : KNOWN_BUGGY_ROBOTS_HASHES;

  let ast;
  try {
    ast = parseSource(source);
  } catch (err) {
    return {
      status: 'parse_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const robotsCall = findGetCallExpression(ast, '/robots.txt');
  if (!robotsCall) {
    return { status: 'no_op', reason: 'robots_handler_not_found' };
  }

  const robotsHandlerNode = robotsCall.node.arguments[1];
  const robotsHandlerBodySrc = generateNodeSrc(robotsHandlerNode, source);
  const shape = classifyHandler(robotsHandlerBodySrc, source);

  if (shape !== 'A') {
    return { status: 'no_op', reason: shape ? `shape_${shape}` : 'unknown_shape' };
  }

  const oldHash = md5(robotsHandlerBodySrc);

  if (allowlist !== null && !allowlist.has(oldHash)) {
    return { status: 'no_op', reason: 'not_in_allowlist', robotsHandlerHash: oldHash };
  }

  const missingRobotsDeps = missingDeps(ast, ROBOTS_BODY_DEPS);
  if (missingRobotsDeps.length > 0) {
    return { status: 'no_op', reason: 'missing_robots_deps', missing: missingRobotsDeps };
  }

  const robotsReplacement = parseExpression(SHAPE_D_ROBOTS_HANDLER);
  const robotsReplacementSrc = generate(robotsReplacement, { comments: false, compact: false }).code;

  let nextSource = source.slice(0, robotsHandlerNode.start)
    + robotsReplacementSrc
    + source.slice(robotsHandlerNode.end);

  let addedImport = false;
  let nextAst;
  try {
    nextAst = parseSource(nextSource);
  } catch (err) {
    return {
      status: 'parse_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!hasIsSystemHostImport(nextAst)) {
    nextSource = insertImportAfterLast(nextSource, nextAst);
    addedImport = true;
  }

  let postAst;
  try {
    postAst = parseSource(nextSource);
  } catch (err) {
    return {
      status: 'parse_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const postRobotsCall = findGetCallExpression(postAst, '/robots.txt');
  const newHandlerBodySrc = postRobotsCall
    ? generateNodeSrc(postRobotsCall.node.arguments[1], nextSource)
    : '';
  const newHash = md5(newHandlerBodySrc);

  return {
    status: 'rewritten',
    source: nextSource,
    addedImport,
    oldShape: 'A',
    newShape: 'D',
    oldHash,
    newHash,
  };
}

/**
 * Verifies the rewritten source is Shape D. Returns true when the
 * /robots.txt handler classifies as Shape D after the rewrite.
 */
export function verifyShapeD(source) {
  let ast;
  try {
    ast = parseSource(source);
  } catch {
    return false;
  }
  const robotsCall = findGetCallExpression(ast, '/robots.txt');
  if (!robotsCall) return false;
  const handlerSrc = generateNodeSrc(robotsCall.node.arguments[1], source);
  return classifyHandler(handlerSrc, source) === 'D';
}

function entryRelPath() {
  return 'src/server/entry.ts';
}

function seoHostRelPath() {
  return 'src/server/seo-host.ts';
}

function isPathDirty(customerDir, relPath) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', relPath], {
      cwd: customerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim().length > 0;
  } catch {
    return true;
  }
}

function isSeoHostValid(seoHostAbs) {
  try {
    const contents = readFileSync(seoHostAbs, 'utf8');
    return contents.includes('export function isSystemHost');
  } catch {
    return false;
  }
}

function tryDelete(absPath) {
  try {
    rmSync(absPath, { force: true });
  } catch {}
}

/**
 * Filesystem wrapper. Returns a structured payload that the CLI logs.
 * Status values:
 *   'skipped'  — pre-conditions not met (file missing, dirty tree, etc.)
 *   'no_op'    — file was inspected and classified as not Shape A
 *   'rewritten' — Shape A → Shape D migration applied successfully
 *   'failed'   — write attempted but post-write verification failed (the
 *                rewritten file is re-read from disk before re-parsing
 *                so a truncated/partial write is caught); the original
 *                file was restored
 *
 * Write ordering: when seo-host.ts is missing, it is written BEFORE
 * entry.ts so the import target exists by the time entry.ts references
 * it. When seo-host.ts already exists, it is sanity-checked for the
 * `isSystemHost` export — a customer-modified seo-host.ts that lost the
 * export would otherwise leave entry.ts unable to compile.
 *
 * Test seams (mirrors the existing `options.allowlist` pattern):
 *   - options.verify     — replaces verifyShapeD; tests pass a stub to
 *                          force the post-write-not-shape-d branch.
 *   - options.writeFile  — replaces writeFileSync for the three write
 *                          calls in this function; tests pass a stateful
 *                          stub to force seo-host/entry write failures
 *                          or the verify-failed-restore-failed double-
 *                          fault. Production callers (the CLI) pass
 *                          neither.
 */
export function rewriteRobotsHandler(customerDir, options = {}) {
  const verify = typeof options.verify === 'function' ? options.verify : verifyShapeD;
  const writeFile = typeof options.writeFile === 'function' ? options.writeFile : writeFileSync;

  const entryAbs = join(customerDir, entryRelPath());
  if (!existsSync(entryAbs)) {
    return { status: 'skipped', reason: 'entry_ts_missing' };
  }

  if (isPathDirty(customerDir, entryRelPath())) {
    return { status: 'skipped', reason: 'entry_ts_dirty' };
  }
  if (isPathDirty(customerDir, seoHostRelPath())) {
    return { status: 'skipped', reason: 'seo_host_ts_dirty' };
  }

  let originalSource;
  try {
    originalSource = readFileSync(entryAbs, 'utf8');
  } catch (err) {
    return {
      status: 'skipped',
      reason: 'entry_ts_read_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const result = rewriteEntryTs(originalSource, options);
  if (result.status === 'parse_failed') {
    return { status: 'skipped', reason: 'parse_failed', error: result.error };
  }
  if (result.status === 'no_op') {
    const out = { status: 'no_op', reason: result.reason };
    if (result.missing) out.missing = result.missing;
    if (result.robotsHandlerHash) out.robotsHandlerHash = result.robotsHandlerHash;
    return out;
  }

  const seoHostAbs = join(customerDir, seoHostRelPath());
  const seoHostExists = existsSync(seoHostAbs);
  if (seoHostExists && !isSeoHostValid(seoHostAbs)) {
    return { status: 'skipped', reason: 'seo_host_invalid' };
  }

  let seoHostCreated = false;
  if (!seoHostExists) {
    try {
      writeFile(seoHostAbs, SEO_HOST_TS_CONTENTS, 'utf8');
      seoHostCreated = true;
    } catch (err) {
      return {
        status: 'failed',
        reason: 'seo_host_write_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    writeFile(entryAbs, result.source, 'utf8');
  } catch (err) {
    if (seoHostCreated) tryDelete(seoHostAbs);
    return {
      status: 'failed',
      reason: 'entry_ts_write_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let writtenSource;
  try {
    writtenSource = readFileSync(entryAbs, 'utf8');
  } catch (err) {
    if (seoHostCreated) tryDelete(seoHostAbs);
    return {
      status: 'failed',
      reason: 'entry_ts_reread_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!verify(writtenSource)) {
    try {
      writeFile(entryAbs, originalSource, 'utf8');
    } catch (err) {
      if (seoHostCreated) tryDelete(seoHostAbs);
      return {
        status: 'failed',
        reason: 'verify_failed_restore_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (seoHostCreated) tryDelete(seoHostAbs);
    return { status: 'failed', reason: 'post_write_not_shape_d' };
  }

  return {
    status: 'rewritten',
    addedImport: result.addedImport,
    seoHostCreated,
    oldShape: result.oldShape,
    newShape: result.newShape,
    oldHash: result.oldHash,
    newHash: result.newHash,
  };
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const customerDir = process.argv[2];
  if (!customerDir) {
    console.error('Usage: node rewrite-robots-handler.js <customer-app-dir>');
    process.exit(1);
  }

  const start = Date.now();
  let result;
  try {
    result = rewriteRobotsHandler(customerDir);
  } catch (err) {
    console.error(JSON.stringify({
      tag: TELEMETRY_TAG,
      event: 'rewrite-robots-handler.failed',
      appId: process.env.SITE_ID || null,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    tag: TELEMETRY_TAG,
    event: 'rewrite-robots-handler.completed',
    appId: process.env.SITE_ID || null,
    durationMs: Date.now() - start,
    ...result,
  }));
  process.exit(result.status === 'failed' ? 1 : 0);
}
