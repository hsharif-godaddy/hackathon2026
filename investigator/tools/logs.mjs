import { tool } from 'ai';
import { z } from 'zod';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';
import { mineLogs } from '../logmine.mjs';

const defaultExec = promisify(_execFile);

const MAX_TEMPLATES = 60;

export function createLogTools({
  rawLogLines = [],
  appId = '',
  skillDir = '/opt/skills/airo-log-investigate',
  fetchImpl = defaultExec,
  preMinedIndex = null,
} = {}) {
  // ── logDigest ──────────────────────────────────────────────────────────
  const logDigest = tool({
    description: [
      'Compressed log overview for this app/window (Drain3 template mining). READ THIS FIRST, before any raw log drilldown — it turns thousands of lines into a handful of templates.',
      '',
      'Returns { anomalies, templates, rare, totalLines, clusterCount }:',
      '  • anomalies — templates ranked by anomaly score (error-bearing + 5xx + rare beat benign chatter). START HERE; these are your highest-value leads.',
      '  • templates — the full set, sorted by frequency.',
      '  • rare      — clusters seen <= rareMaxCount times.',
      '',
      'TYPICAL FLOW: read anomalies → pick a suspicious template → fetchLogLines with a fragment of it to pull the raw rows for citations. A clusterCount of 0 means no logs were available (note returned) — investigate from code + conversation and flag the coverage gap.',
    ].join('\n'),
    inputSchema: z.object({
      rareMaxCount: z.number().int().default(1).describe('clusters seen <= this many times are surfaced in `rare` (default 1)'),
    }),
    execute: async ({ rareMaxCount }) => {
      try {
        // Use pre-mined index when available (avoids double-mining).
        const d = preMinedIndex ?? mineLogs(rawLogLines, { rareMaxCount });
        const templates = d.templates.slice(0, MAX_TEMPLATES);
        const rare = d.templates.filter((t) => t.count <= rareMaxCount);
        return {
          ok: true,
          anomalies: d.anomalies ?? [],
          templates,
          rare,
          totalLines: d.totalLines,
          clusterCount: d.clusterCount,
          truncated: d.templates.length > MAX_TEMPLATES,
          ...(d.clusterCount === 0
            ? { note: 'no log lines available for this app/window — investigate from code + conversation, and state the missing-logs coverage gap in the report' }
            : {}),
        };
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },
  });

  // ── fetchLogLines ──────────────────────────────────────────────────────
  const fetchLogLines = tool({
    description: [
      'Pull RAW log lines for one service, optionally filtered to a template fragment — use this to get the exact lines you cite as evidence.',
      '',
      'WHEN TO USE: AFTER logDigest, to drill into a specific anomalous template (pass a distinctive substring of it as `contains`).',
      'WHEN NOT TO USE: as a first step (read logDigest first) — pulling raw lines blind wastes context.',
      '',
      'Example: { service: "airo-agents", contains: "ECONNREFUSED", window: "1h", limit: 50 }.',
    ].join('\n'),
    inputSchema: z.object({
      service: z.string().optional().describe('service name, e.g. airo-agents, airo-preview-application, airo-publish'),
      plane: z.string().default('data').describe('log plane (default "data")'),
      contains: z.string().optional().describe('substring filter — a distinctive fragment of a template from logDigest'),
      window: z.string().default('1h').describe('time window, e.g. 1h, 24h (default 1h)'),
      limit: z.number().int().default(100).describe('max lines to return (default 100)'),
    }),
    execute: async ({ service, plane, contains, window, limit }) => {
      try {
        const scriptPath = `${skillDir}/fetch_log_lines.py`;
        const args = ['python3.11', scriptPath, '--appId', appId, '--plane', plane, '--window', window, '--limit', String(limit)];
        // M2: execFile already blocks shell injection and the Python escapes the
        // LogQL line-filter; cap these model-controlled strings as belt-and-suspenders
        // so a prompt-injected payload can't push an oversized/abusive filter.
        if (service) args.push('--service', String(service).slice(0, 200));
        if (contains) args.push('--contains', String(contains).slice(0, 500));
        const { stdout } = await fetchImpl(args[0], args.slice(1), { timeout: 35_000 });
        const parsed = JSON.parse(stdout);
        return parsed;
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },
  });

  return { logDigest, fetchLogLines };
}
