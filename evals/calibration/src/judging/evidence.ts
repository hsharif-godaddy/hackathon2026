import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { CapturedSite } from '../site-capture/types.js';
import { isObject } from '../utils.js';

export interface DatasetEvidence {
  simulationId: string;
  previewUrl: string;
  simulationRow: Record<string, unknown> | null;
  scenarioRow: Record<string, unknown> | null;
  evaluations: Array<Record<string, unknown>>;
  /** Production GoArena score per evaluatorId (0–100), used as calibration ground truth. */
  productionScores: Record<string, number>;
  pageContent: Record<string, unknown> | null;
  conversation: {
    originalPrompt: string | null;
    userMessages: string[];
    messages: Array<{ turn: number; role: string; content: string }>;
    totalTurns: number;
  };
  toolInvocations: Array<{
    name: string;
    input: unknown;
    output: unknown;
    startTime: string | null;
    endTime: string | null;
  }>;
  siteCapture: CapturedSite | null;
  screenshots: Array<{ label: string; path: string }>;
}

function isCapturedSite(val: unknown): val is CapturedSite {
  if (!isObject(val)) return false;
  const obj = val as Record<string, unknown>;
  return typeof obj['previewUrl'] === 'string' && Array.isArray(obj['perRoute']) && Array.isArray(obj['routes']);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function readMessages(conversationHistory: unknown): DatasetEvidence['conversation'] {
  const rows = Array.isArray(conversationHistory) ? conversationHistory : [];
  const messages = rows
    .map((row, i) => {
      if (!isObject(row)) return null;
      const role = readString(row['role']) ?? 'unknown';
      const content = readString(row['content']) ?? '';
      return { turn: i + 1, role, content };
    })
    .filter(Boolean) as Array<{ turn: number; role: string; content: string }>;

  const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content).filter(Boolean);

  return {
    originalPrompt: userMessages[0] ?? null,
    userMessages,
    messages,
    totalTurns: messages.length,
  };
}

function readToolInvocations(observations: unknown): DatasetEvidence['toolInvocations'] {
  if (!Array.isArray(observations)) return [];
  const out: DatasetEvidence['toolInvocations'] = [];
  for (const obs of observations) {
    if (!isObject(obs)) continue;
    if (obs['type'] !== 'TOOL') continue;
    out.push({
      name: readString(obs['name']) ?? 'unknown',
      input: obs['input'],
      output: obs['output'],
      startTime: readString(obs['startTime']),
      endTime: readString(obs['endTime']),
    });
  }
  return out;
}

function readNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Build a production-score lookup. Production rows may be keyed by the evaluator's slug
 * (`airo-content-specificity`) OR by an opaque evaluator UUID, in which case the human mapping
 * lives in `scoreName` (e.g. `ambiguity_handling_quality`). We index by BOTH `evaluatorId` and
 * `scoreName` so a caller can resolve a score by either the evaluator id or its scoreName.
 * Prefers the deduped first-per-evaluator file; falls back to the full evaluations rows.
 */
function readProductionScores(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (!isObject(row)) continue;
    const score = readNumber(row['score']) ?? readNumber(row['numericScore']);
    if (score === null) continue;
    for (const key of [readString(row['evaluatorId']), readString(row['scoreName'])]) {
      if (key && !(key in out)) out[key] = score; // first occurrence wins per key
    }
  }
  return out;
}

function chooseScreenshots(capture: CapturedSite | null): Array<{ label: string; path: string }> {
  const routes = capture?.perRoute ?? [];
  if (!routes.length) return [];

  const out: Array<{ label: string; path: string }> = [];
  for (const route of routes) {
    const tiles = route.perViewport?.['laptop']?.tiles ?? [];
    for (const tile of tiles) {
      if (!tile?.path) continue;
      out.push({ label: `laptop:${route.path}:tile${tile.index}`, path: tile.path });
    }
  }

  return out;
}

export async function loadEvidence(simDir: string): Promise<DatasetEvidence> {
  const meta = await readJson(path.join(simDir, 'meta.json'));
  if (!isObject(meta)) throw new Error(`Invalid meta.json: ${simDir}`);
  const simulationId = readString(meta['simulationId']);
  const previewUrl = readString(meta['previewUrl']);
  if (!simulationId) throw new Error(`Missing meta.simulationId: ${simDir}`);
  if (!previewUrl) throw new Error(`Missing meta.previewUrl: ${simDir}`);

  const simulationRow = await readJson(path.join(simDir, 'dynamodb', 'synthia-simulations.json'));
  const scenarioRow = await readJson(path.join(simDir, 'dynamodb', 'synthia-scenario.json'));
  const evaluations = await readJson(path.join(simDir, 'dynamodb', 'synthia-evaluations.json'));
  const evaluationsFirstPerEvaluator = await readJson(
    path.join(simDir, 'dynamodb', 'synthia-evaluations.first-per-evaluator.json'),
  ).catch(() => null);
  const observations = await readJson(path.join(simDir, 'langfuse', 'observations.json'));

  const simObj = isObject(simulationRow) ? simulationRow : null;
  const scenarioObj = isObject(scenarioRow) ? scenarioRow : null;
  const pageContent = isObject(simObj?.['pageContent']) ? (simObj?.['pageContent'] as Record<string, unknown>) : null;

  const siteCaptureRaw = await readJson(path.join(simDir, 'site', 'capture.json')).catch(() => null);
  const siteCapture = isCapturedSite(siteCaptureRaw) ? siteCaptureRaw : null;

  return {
    simulationId,
    previewUrl,
    simulationRow: simObj,
    scenarioRow: scenarioObj,
    evaluations: Array.isArray(evaluations) ? (evaluations as Array<Record<string, unknown>>) : [],
    productionScores: readProductionScores(evaluationsFirstPerEvaluator ?? evaluations),
    pageContent,
    conversation: readMessages(simObj?.['conversationHistory']),
    toolInvocations: readToolInvocations(observations),
    siteCapture,
    screenshots: chooseScreenshots(siteCapture),
  };
}

