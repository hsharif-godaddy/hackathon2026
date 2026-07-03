import { parse, Lang } from '@ast-grep/napi';
import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';

const execFileAsync = promisify(_execFile);

const MAX_MATCHES = 50;
const MAX_SPAN_LINES = 200;
const MAX_DETAIL = 400;

function clamp(s, max = MAX_DETAIL) {
  const str = String(s ?? '');
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/** Ensure a file path is inside appCodeDir (prevent traversal). */
function assertInAppDir(filePath, appCodeDir) {
  const abs = resolve(appCodeDir, filePath);
  const rel = relative(appCodeDir, abs);
  if (rel.startsWith('..') || rel.startsWith(sep + '..')) {
    throw new Error(`path traversal: ${filePath}`);
  }
  return abs;
}

/**
 * A pattern that is ONLY metavariables (`$A`, `$_`, `$$$`, or several of them)
 * with no literal code matches every node — useless. Strip metavars + whitespace;
 * if nothing remains, it's trivial.
 */
function isTrivialPattern(pattern) {
  const stripped = String(pattern ?? '')
    .replace(/\$\$\$|\$[A-Za-z_0-9]+/g, '')
    .replace(/\s+/g, '');
  return stripped.length === 0;
}

/** Check if a pattern string is syntactically invalid by parsing it as source. */
function isInvalidPattern(lang, pattern) {
  try {
    // Metavariables ($A, $$$) are not valid TS syntax — strip them before parsing
    const stripped = pattern.replace(/\$+[A-Z_a-z0-9]*/g, 'x');
    const root = parse(Lang[lang], stripped).root();
    const hasError = (node) => {
      if (node.kind() === 'ERROR') return true;
      return node.children().some(hasError);
    };
    return hasError(root);
  } catch {
    return true;
  }
}

/** Collect single-letter metavar matches from a pattern + node. */
function collectMetavars(node, pattern) {
  const meta = {};
  const vars = [...pattern.matchAll(/\$([A-Z])\b/g)].map((m) => m[1]);
  for (const name of vars) {
    const match = node.getMatch(name);
    if (match) meta[name] = clamp(match.text());
  }
  return meta;
}

export function createRetrievalTools({ appCodeDir = '/tmp', crgClient = null, exec = execFileAsync } = {}) {
  // ── astGrep ──────────────────────────────────────────────────────────────
  const astGrep = tool({
    description: [
      'Structural (AST) code search over the customer app. Matches code by SHAPE, not text, using ast-grep patterns where `$NAME` is a metavariable that captures one node and `$$$` captures a list.',
      '',
      'WHEN TO USE: to find an exact code construct once you know its shape — a specific call, a try/catch, an import, a JSX element. Prefer this over readSpan/ripgrep when you can express the shape.',
      'WHEN NOT TO USE: to find a file or symbol by name (use ripgrepSeed) or to read a known location (use readSpan).',
      '',
      'GOOD patterns (literal code + metavariables):',
      '  • downloadResource($A)            — every call to downloadResource',
      '  • import $A from "$B"             — every import statement',
      '  • catch ($E) { $$$ }              — every catch block',
      '  • useEffect($A, $B)               — every useEffect call',
      'BAD patterns (rejected): a bare metavariable like `$A`, `$_`, or `$$$` — these match EVERY node and tell you nothing. A pattern MUST contain real code around the metavariable.',
      '',
      'Returns { matches: [{ text, range, meta }], truncated }. `meta` holds the captured metavariable values.',
    ].join('\n'),
    inputSchema: z.object({
      lang: z.enum(['TypeScript', 'Tsx']).default('TypeScript').describe('Tsx for files with JSX, TypeScript otherwise'),
      pattern: z.string().describe('ast-grep pattern containing literal code + metavariables, e.g. `downloadResource($A)` or `import $A from "$B"`. Must NOT be a bare metavariable like `$A`.'),
      file: z.string().optional().describe('path relative to the app root, e.g. src/routes.tsx; omit when passing inline source'),
      source: z.string().optional().describe('inline source string (for small snippets/tests); omit when passing a file'),
    }),
    execute: async ({ lang, pattern, file, source }) => {
      try {
        // Teaching guard: a bare metavariable matches every node — useless. Reject
        // with a corrective hint so the model issues a real shape next turn.
        if (isTrivialPattern(pattern)) {
          return { ok: false, error: `pattern too broad: "${clamp(pattern, 60)}" is only metavariables and matches every node. Include literal code around the metavariable, e.g. downloadResource($A) or \`import $A from "$B"\`.` };
        }
        let src;
        if (source !== undefined) {
          src = source;
        } else if (file) {
          const abs = assertInAppDir(file, appCodeDir);
          src = await readFile(abs, 'utf-8');
        } else {
          return { ok: false, error: 'provide either `file` (path relative to app root) or `source` (inline snippet)' };
        }
        if (isInvalidPattern(lang, pattern)) {
          return { ok: false, error: `invalid ast-grep pattern: ${clamp(pattern)} — check syntax; metavariables are $NAME (one node) or $$$ (a list)` };
        }
        const root = parse(Lang[lang], src).root();
        const nodes = root.findAll(pattern);
        const matches = nodes.slice(0, MAX_MATCHES).map((n) => ({
          text: clamp(n.text()),
          range: { startLine: n.range().start.line, startCol: n.range().start.column, endLine: n.range().end.line },
          meta: collectMetavars(n, pattern),
        }));
        return {
          ok: true,
          matches,
          truncated: nodes.length > MAX_MATCHES,
          ...(matches.length === 0 ? { note: `no AST matches for pattern: ${clamp(pattern)}` } : {}),
        };
      } catch (err) {
        return { ok: false, error: clamp(err?.message || String(err)) };
      }
    },
  });

  // ── ripgrepSeed ──────────────────────────────────────────────────────────
  const ripgrepSeed = tool({
    description: [
      'Fast text/regex search over the customer app code. Returns file:line:text hits.',
      '',
      'WHEN TO USE: to LOCATE where a symbol, string, route, or error message lives by name — the starting point of a fault path (e.g. find the file that defines `useCart`, or where "checkout" appears).',
      'WHEN NOT TO USE: to match a code SHAPE (use astGrep) or to read a span you already located (use readSpan).',
      '',
      'Examples: `useCart` · `cart|checkout|CartContext` · `class \\w+Service` · `TODO|FIXME`.',
      'Empty result returns { hits: [], note }. Follow up by reading a promising hit with readSpan or expanding via crgQuery.',
    ].join('\n'),
    inputSchema: z.object({
      query: z.string().describe('literal string or regex, e.g. `useCart` or `cart|checkout`'),
      maxHits: z.number().int().default(40).describe('cap on hits returned (default 40)'),
    }),
    execute: async ({ query, maxHits }) => {
      try {
        const { stdout } = await exec('rg', ['--line-number', '--no-heading', '-m', String(maxHits), query, appCodeDir], { timeout: 15_000 });
        const hits = stdout.split('\n').filter(Boolean).slice(0, maxHits).map((line) => {
          const m = line.match(/^(.+):(\d+):(.*)$/);
          if (!m) return null;
          const [, absFile, lineNo, text] = m;
          return { file: relative(appCodeDir, absFile), line: Number(lineNo), text: clamp(text, 200) };
        }).filter(Boolean);
        return { ok: true, hits, ...(hits.length === 0 ? { note: `no matches for query: ${clamp(query, 120)}` } : {}) };
      } catch (err) {
        // rg exits 1 on no matches (documented). Exit 2 = real error (bad regex, etc).
        if (err?.code === 1) {
          return { ok: true, hits: [], note: `no matches for query: ${clamp(query, 120)}` };
        }
        return { ok: false, error: clamp(err?.message || String(err)) };
      }
    },
  });

  // ── readSpan ─────────────────────────────────────────────────────────────
  const readSpan = tool({
    description: [
      'Read a bounded line range from one file in the customer app.',
      '',
      'WHEN TO USE: to read the code at a location you ALREADY found via astGrep/ripgrepSeed/crgQuery (use their reported file + line).',
      'WHEN NOT TO USE: to discover where something is (use ripgrepSeed/astGrep first) — and never to read a whole file; keep ranges tight (≤200 lines).',
      '',
      'Example: { file: "src/routes.tsx", fromLine: 40, toLine: 80 }. Returns { text, fromLine, toLine, truncated }.',
    ].join('\n'),
    inputSchema: z.object({
      file: z.string().describe('path relative to the app root, e.g. src/routes.tsx'),
      fromLine: z.number().int().min(1).describe('1-based start line (>= 1)'),
      toLine: z.number().int().min(1).describe('1-based end line, inclusive (>= fromLine, max 200 lines from fromLine)'),
    }),
    execute: async ({ file, fromLine, toLine }) => {
      try {
        // I4: guard against 0/negative lines. slice(fromLine-1) with fromLine<=0
        // becomes slice(-1) and silently returns the WRONG (or empty) span with
        // ok:true. Fail loud instead. (The schema .min(1) covers SDK-validated
        // calls; this also covers direct/test invocation.)
        if (!Number.isInteger(fromLine) || fromLine < 1) {
          return { ok: false, error: `fromLine must be an integer >= 1 (got ${fromLine})` };
        }
        if (!Number.isInteger(toLine) || toLine < fromLine) {
          return { ok: false, error: `toLine must be an integer >= fromLine (got ${toLine})` };
        }
        const abs = assertInAppDir(file, appCodeDir);
        const clampedTo = Math.min(toLine, fromLine + MAX_SPAN_LINES - 1);
        const content = await readFile(abs, 'utf-8');
        const lines = content.split('\n');
        const span = lines.slice(fromLine - 1, clampedTo).join('\n');
        return { ok: true, file, fromLine, toLine: clampedTo, text: clamp(span, 8000), truncated: clampedTo < toLine };
      } catch (err) {
        return { ok: false, error: clamp(err?.message || String(err)) };
      }
    },
  });

  // Op → ordered list of candidate tool-name fragments to search for.
  // Accounts for both CRG servers that expose op-named tools (callers_of, etc.)
  // and servers that expose a single query_graph tool or semantic_search_nodes.
  const CRG_OP_CANDIDATES = {
    callers_of:      ['callers_of', 'query_graph'],
    callees_of:      ['callees_of', 'query_graph'],
    impact_radius:   ['impact_radius', 'get_impact_radius', 'query_graph'],
    tests_for:       ['tests_for', 'query_graph'],
    imports_of:      ['imports_of', 'query_graph'],
    semantic_search: ['semantic_search', 'semantic_search_nodes'],
  };

  // ── crgQuery ─────────────────────────────────────────────────────────────
  const crgQuery = tool({
    description: [
      'Query the code-review-graph (CRG) for structural RELATIONSHIPS without reading files — this is the "where does this connect?" tool.',
      '',
      'OPERATIONS:',
      '  • semantic_search — find relevant code areas/symbols by natural-language description (best FIRST step to localize an unfamiliar codebase).',
      '  • callers_of      — who calls this function/symbol (trace a fault upward).',
      '  • callees_of      — what this function calls (trace downward).',
      '  • impact_radius   — what breaks if this changes.',
      '  • tests_for       — tests covering this symbol.',
      '  • imports_of      — what imports this module.',
      '',
      'TYPICAL FLOW: semantic_search to find the area → callers_of/callees_of to trace the path → readSpan to read the precise code. Prefer this over scanning files by hand.',
    ].join('\n'),
    inputSchema: z.object({
      op: z.enum(['callers_of', 'callees_of', 'impact_radius', 'tests_for', 'imports_of', 'semantic_search'])
        .describe('relationship to query; use semantic_search to localize first'),
      target: z.string().describe('a symbol/function name (e.g. useCart) or path for the relationship ops; a natural-language description for semantic_search'),
      repoRoot: z.string().optional().describe('repo root to scope the query; omit for customer app graph (defaults to app dir); pass the platform graph path from the system prompt for platform code'),
    }),
    execute: async ({ op, target, repoRoot }) => {
      if (!crgClient) return { ok: false, error: 'code graph unavailable (CRG not initialised)' };
      const resolvedRoot = repoRoot || appCodeDir || '';
      if (!resolvedRoot) return { ok: false, error: 'code graph unavailable (no repo root — pass repoRoot explicitly or ensure appCodeDir is set)' };
      try {
        const availableTools = await crgClient.tools();
        const availableNames = Object.keys(availableTools);
        // Find the best matching tool using the candidate list for this op
        const candidates = CRG_OP_CANDIDATES[op] || [op];
        // Exact match wins across ALL candidates first; only then fall back to a
        // substring match. Otherwise a server exposing `query_graph_helper` could
        // be picked over an exact `query_graph` purely by object-key order.
        let toolName = candidates.find((c) => availableNames.includes(c));
        if (!toolName) {
          for (const candidate of candidates) {
            toolName = availableNames.find((k) => k.includes(candidate));
            if (toolName) break;
          }
        }
        // Last-resort: mcp__crg__ prefix convention
        if (!toolName) toolName = `mcp__crg__${op}`;
        const crgTool = availableTools[toolName];
        if (!crgTool) return { ok: false, error: `CRG tool for op '${op}' not found (available: ${availableNames.join(', ')})` };
        // Build params for the resolved tool.
        // semantic_search_nodes_tool expects { query } not { target }.
        // query_graph-style tools need a pattern to know which relationship to query.
        const params = {};
        if (op === 'semantic_search') {
          params.query = target;
        } else {
          params.target = target;
        }
        if (resolvedRoot) params.repo_root = resolvedRoot;
        if (toolName === 'query_graph' || toolName.includes('query_graph')) params.pattern = op;
        const result = await crgTool.execute(params);
        return { ok: true, op, target, result };
      } catch (err) {
        return { ok: false, error: clamp(err?.message || String(err)) };
      }
    },
  });

  return { astGrep, ripgrepSeed, readSpan, crgQuery };
}
