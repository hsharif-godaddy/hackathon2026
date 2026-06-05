// Parse Claude CLI stream-json stdout lines into human-readable "activity"
// rows for the debug-console Investigate panel.
//
// The Lambda spawns `claude` with `--output-format=stream-json --verbose`
// (handler.mjs spawnClaude), so each stdout line is one JSON event. Assistant
// turns carry `tool_use` content blocks (the agent's actions). This module
// turns those into a curated, UI-friendly feed — "Searching code: …",
// "Reading index.tsx", "Querying code graph: …", "Searching logs" — so an
// operator can watch what the investigation is actually doing, mirroring the
// per-action step list in Cursor / Lovable / the AAB builder.
//
// PURE + best-effort, exactly like parsePhaseFromLine in handler.mjs: any
// malformed / non-assistant / non-tool_use line yields []. We never throw —
// the caller fire-and-forgets an `activity` event per returned row.
//
// CURATED: only the tools that represent meaningful investigation work are
// surfaced (code read/search, code-graph queries, log-script runs). Noise
// (TodoWrite, housekeeping Bash, Write/Edit) is dropped so the feed reads like
// a sequence of intentional steps, not a raw tool log.

// Bound the detail string. events.mjs also caps the whole payload to 4 KB and
// truncates strings to 512; this keeps the per-row input compact regardless.
const MAX_DETAIL_LEN = 300;

// The code-review-graph MCP server is registered under this name in
// graph-setup.writeMcpConfig, so its tools arrive as `mcp__crg__<tool>`.
const CRG_TOOL_PREFIX = 'mcp__crg__';

/**
 * @typedef {Object} ToolActivity
 * @property {string} tool  the raw tool name (Read, Grep, mcp__crg__query_graph, …)
 * @property {string} label short human summary (action + target)
 * @property {string} detail the exact tool input (path / pattern / query / command)
 */

/** Trim + bound a string for the `detail` field. */
function clamp(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const trimmed = s.trim();
  return trimmed.length > MAX_DETAIL_LEN ? trimmed.slice(0, MAX_DETAIL_LEN) + '…' : trimmed;
}

/** Last path segment, without importing node:path (keep this module pure/portable). */
function basename(p) {
  if (typeof p !== 'string' || p.length === 0) return '';
  const parts = p.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

// The skill reads its OWN instruction files (phase-0/1/2, SKILL.md, the
// references notebook) and other Claude-home plumbing. Those are internal to
// this tool, not investigation steps an operator cares about — drop them.
const INTERNAL_READ_RE = /\/\.claude\/|\/skills\/airo-log-investigate\//;
function isInternalRead(file) {
  return INTERNAL_READ_RE.test(file);
}

// Show the customer app file as a repo-relative path (src/pages/index.tsx),
// never the throwaway absolute temp path (/tmp/inv-<id>/app/src/pages/...).
function appRelativePath(file) {
  const base = process.env.APP_CODE_DIR;
  if (base && file.startsWith(base)) {
    return file.slice(base.length).replace(/^\/+/, '') || basename(file);
  }
  return null;
}

// Raw log refs live under .../airo-log-investigate/{appId}/{source}/...; pull
// the source segment so a drill-in reads as "Inspecting airo-preview logs"
// instead of a meaningless temp path.
function logSourceFromPath(file) {
  const m = file.match(/airo-log-investigate\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Map a single `tool_use` block to a curated activity row, or null to skip it.
 *
 * @param {{ name?: string, input?: Record<string, unknown> }} block
 * @returns {ToolActivity | null}
 */
function activityForBlock(block) {
  const name = typeof block?.name === 'string' ? block.name : '';
  const input = block && typeof block.input === 'object' && block.input ? block.input : {};
  if (!name) return null;

  // code-review-graph MCP — structural queries (callers/impact/search/tests).
  if (name.startsWith(CRG_TOOL_PREFIX)) {
    const op = name.slice(CRG_TOOL_PREFIX.length);
    // Most CRG tools key on one of these; show whichever is present.
    const target =
      input.target ?? input.query ?? input.pattern ?? input.symbol ?? input.node ?? '';
    const targetStr = typeof target === 'string' ? target : '';
    const label = targetStr ? `Querying code graph: ${op} ${targetStr}` : `Querying code graph: ${op}`;
    return { tool: name, label, detail: clamp(targetStr || op) };
  }

  switch (name) {
    case 'Read': {
      const file = typeof input.file_path === 'string' ? input.file_path : '';
      if (!file) return null;
      // Drop the tool's own instruction/plumbing files (phase-0/1/2, SKILL.md,
      // references notebook, Claude home) — not an investigation step.
      if (isInternalRead(file)) return null;
      // Agent conversation transcript (read via $CONVERSATIONS_PATH).
      if (process.env.CONVERSATIONS_PATH && file === process.env.CONVERSATIONS_PATH) {
        return { tool: name, label: 'Reading agent conversation', detail: 'agent conversation transcript' };
      }
      // Customer app code → repo-relative path, never the temp absolute path.
      const rel = appRelativePath(file);
      if (rel) return { tool: name, label: `Reading ${rel}`, detail: rel };
      // Log working dir: a specific source's raw records, or the compact index.
      if (file.includes('airo-log-investigate/')) {
        const src = logSourceFromPath(file);
        return src
          ? { tool: name, label: `Inspecting ${src} logs`, detail: `${src} log records` }
          : { tool: name, label: 'Reading log index', detail: 'compact log index' };
      }
      // Anything else: friendly name, no temp path leaked into the detail.
      return { tool: name, label: `Reading ${basename(file) || 'file'}`, detail: basename(file) || 'file' };
    }
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const rawScope = typeof input.path === 'string' ? input.path : (typeof input.glob === 'string' ? input.glob : '');
      // Show the search scope repo-relative, not as a temp absolute path.
      const scope = rawScope ? (appRelativePath(rawScope) ?? rawScope) : '';
      const label = `Searching code: "${pattern}"`;
      return { tool: name, label, detail: clamp(scope ? `${pattern}  (${scope})` : pattern) };
    }
    case 'Glob': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return { tool: name, label: `Finding files: ${pattern}`, detail: clamp(pattern) };
    }
    case 'Bash': {
      const command = typeof input.command === 'string' ? input.command : '';
      // Only the frontend-log search script is meaningful here; other Bash is
      // housekeeping noise (cd, ls, mkdir) and is dropped.
      if (!command.includes('search_frontend_logs.py')) return null;
      return { tool: name, label: 'Searching logs', detail: clamp(command) };
    }
    default:
      // TodoWrite, Write, Edit, and anything else → not part of the feed.
      return null;
  }
}

/**
 * Extract curated tool activities from one stream-json stdout line.
 *
 * @param {string} jsonLine a single line of Claude CLI stream-json output
 * @returns {ToolActivity[]} zero or more activity rows (empty on any non-match)
 */
export function extractToolActivities(jsonLine) {
  if (typeof jsonLine !== 'string' || jsonLine.trim().length === 0) return [];
  let event;
  try {
    event = JSON.parse(jsonLine);
  } catch {
    return [];
  }
  if (!event || event.type !== 'assistant') return [];
  const content = event.message && Array.isArray(event.message.content) ? event.message.content : [];
  const activities = [];
  for (const block of content) {
    if (block && block.type === 'tool_use') {
      const activity = activityForBlock(block);
      if (activity) activities.push(activity);
    }
  }
  return activities;
}
