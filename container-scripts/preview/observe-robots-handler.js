#!/usr/bin/env node

/**
 * RUBICON-373 — telemetry-only observer for src/server/entry.ts.
 *
 * Classifies the customer's /robots.txt handler into one of the known
 * shapes (A–E + unknown), hashes the handler body, and emits a structured
 * log event tagged with the app's SITE_ID so fleet-wide queries can
 * dedupe per app across container restarts. Same for /sitemap.xml when
 * present.
 *
 * NO WRITES. This script does not modify entry.ts. Its only side effect
 * is one log line per preview-container startup, used to size the shape
 * distribution across the fleet and capture representative samples for
 * local AST validation.
 *
 * Shape table:
 *   E  — already on the post-RUBICON-373 contract (fingerprint present)
 *   D  — interim isSystemHost(req) gate
 *   C  — isCanonicalHost(req) gate
 *   B  — process.env.SEO_INDEX_MODE env-gated
 *   A  — pre-RUBICON-373 always-Allow
 *   null — handler exists but matches no known shape
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

// Source-level marker for Shape E. Lives in the AIRO_PREVIEW_SUFFIXES literal,
// not the handler body — checked against the whole file so a re-classified
// patched app does not slip into Shape A.
const SHAPE_E_FINGERPRINT = '.test-airoapp.ai';

// Descriptive reason labels per shape — used as the single Loki bucketing
// field so a query author can read `reason` without consulting a
// shape-letter cheat sheet. Naming convention: each label hints at what
// to grep the source for (e.g. `canonical_host_gated` → isCanonicalHost).
// Shapes with no key here fall through to 'unknown_shape' (handler exists
// but matches no known shape).
const SHAPE_TO_REASON = {
  A: 'unconditional_allow',
  B: 'env_gated',
  C: 'canonical_host_gated',
  D: 'system_host_gated',
  E: 'airo_suffix_gated',
};

const BODY_EXCERPT_MAX_BYTES = 4096;

// Stable tag stamped on every emitted line so a single Loki query
// (`|= "RUBICON-373"` or `| json | tag="RUBICON-373"`) can pull every
// telemetry event tied to this ticket.
const TELEMETRY_TAG = 'RUBICON-373';

// Read at call time so tests can toggle per-case and operators can flip
// the flag without restarting the host process.
function bodyLoggingEnabled() {
  return process.env.LOG_ROBOTS_HANDLER_BODY === '1';
}

export function findGetCallExpression(ast, routePath) {
  let foundPath = null;
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        !t.isMemberExpression(callee) ||
        !t.isIdentifier(callee.property) ||
        callee.property.name !== 'get'
      ) {
        return;
      }
      const args = path.node.arguments;
      if (args.length < 2) return;
      const firstArg = args[0];
      if (!t.isStringLiteral(firstArg) || firstArg.value !== routePath) return;
      foundPath = path;
      path.stop();
    },
  });
  return foundPath;
}

export function generateNodeSrc(node, source) {
  // Normalized round-trip through the generator so two semantically equal
  // handler bodies hash to the same value regardless of original whitespace.
  return generate(node, { comments: false, compact: false }, source).code;
}

function md5(s) {
  return createHash('md5').update(s).digest('hex');
}

export function classifyHandler(handlerBodySrc, fullSource) {
  if (fullSource.includes(SHAPE_E_FINGERPRINT)) return 'E';
  if (handlerBodySrc.includes('isSystemHost')) return 'D';
  if (handlerBodySrc.includes('isCanonicalHost')) return 'C';
  if (handlerBodySrc.includes('SEO_INDEX_MODE')) return 'B';
  if (handlerBodySrc.includes('Allow') && handlerBodySrc.includes('Sitemap')) return 'A';
  return null;
}

/**
 * Pure inspection of an entry.ts source string. Returns one of:
 *   { reason: 'parse_failed', error }
 *   { reason: 'robots_handler_not_found' }
 *   { shape, robotsHandlerHash, hasSitemap, sitemapHash, robotsHandlerBody }
 */
export function inspectEntryTs(source) {
  let ast;
  try {
    ast = babelParse(source, { sourceType: 'module', plugins: ['typescript'] });
  } catch (err) {
    return {
      reason: 'parse_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const robotsCall = findGetCallExpression(ast, '/robots.txt');
  if (!robotsCall) {
    return { reason: 'robots_handler_not_found' };
  }

  const robotsHandlerNode = robotsCall.node.arguments[1];
  const robotsHandlerBody = generateNodeSrc(robotsHandlerNode, source);
  const shape = classifyHandler(robotsHandlerBody, source);

  const sitemapCall = findGetCallExpression(ast, '/sitemap.xml');
  let sitemapHash = null;
  if (sitemapCall) {
    const sitemapBody = generateNodeSrc(sitemapCall.node.arguments[1], source);
    sitemapHash = md5(sitemapBody);
  }

  return {
    shape,
    robotsHandlerHash: md5(robotsHandlerBody),
    hasSitemap: Boolean(sitemapCall),
    sitemapHash,
    robotsHandlerBody,
  };
}

/**
 * Filesystem wrapper. Returns the structured payload that the CLI logs.
 * Status semantics:
 *   'skipped'  — could not read or no handler at all (no per-app data)
 *   'observed' — got far enough to classify (or to know parsing failed)
 */
export function observeRobotsHandler(customerDir) {
  const entryPath = join(customerDir, 'src/server/entry.ts');
  if (!existsSync(entryPath)) {
    return { status: 'skipped', reason: 'entry_ts_missing' };
  }

  let source;
  try {
    source = readFileSync(entryPath, 'utf8');
  } catch (err) {
    return {
      status: 'skipped',
      reason: 'entry_ts_read_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const result = inspectEntryTs(source);

  if ('reason' in result) {
    const out = {
      status: 'observed',
      reason: result.reason,
    };
    if (result.error) out.error = result.error;
    if (bodyLoggingEnabled() && result.reason === 'parse_failed') {
      out.entrySrcExcerpt = source.slice(0, BODY_EXCERPT_MAX_BYTES);
    }
    return out;
  }

  const { shape, robotsHandlerHash, hasSitemap, sitemapHash, robotsHandlerBody } = result;
  const out = {
    status: 'observed',
    reason: SHAPE_TO_REASON[shape] || 'unknown_shape',
    shape,
    robotsHandlerHash,
    hasSitemap,
    sitemapHash,
  };
  if (bodyLoggingEnabled() && shape === null) {
    out.robotsHandlerBody = robotsHandlerBody.slice(0, BODY_EXCERPT_MAX_BYTES);
  }
  return out;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const customerDir = process.argv[2];
  if (!customerDir) {
    console.error('Usage: node observe-robots-handler.js <customer-app-dir>');
    process.exit(1);
  }

  const start = Date.now();
  let result;
  try {
    result = observeRobotsHandler(customerDir);
  } catch (err) {
    console.error(JSON.stringify({
      tag: TELEMETRY_TAG,
      event: 'observe-robots-handler.failed',
      appId: process.env.SITE_ID || null,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }));
    // Telemetry must never block startup.
    process.exit(0);
  }

  console.log(JSON.stringify({
    tag: TELEMETRY_TAG,
    event: 'observe-robots-handler.completed',
    appId: process.env.SITE_ID || null,
    durationMs: Date.now() - start,
    ...result,
  }));
  process.exit(0);
}
