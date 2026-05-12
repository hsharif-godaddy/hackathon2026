import { readFile } from 'node:fs/promises';

import type { DOMSnapshot } from '../runner/transcript.js';

const MAX_TEXT_CHARS = 20_000;
const MAX_HTML_CHARS = 20_000;

/**
 * Cap for HTML injected into LLM evaluator prompts.
 * ~2k tokens at ~4 chars/token, leaving headroom for transcript + goals + instructions.
 * Smaller than MAX_HTML_CHARS (20K) which is used for full-page extraction.
 */
export const LLM_PROMPT_HTML_MAX_CHARS = 8_000;

const BODY_RE = /<body[^>]*>([\s\S]*)<\/body>/i;

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Shared sigmoid curve parameters for raw-count evaluators.
 * All evaluators share the same curve shape for cross-scenario comparability.
 */
export const SIGMOID_MIDPOINT = 15;
export const SIGMOID_STEEPNESS = 0.2;

/**
 * Maps a raw count (agent steps, user turns) to a (0, 1) score via sigmoid.
 * Fewer steps/turns produce higher scores.
 * @param count Non-negative finite number. Throws RangeError if NaN or negative.
 * @param midpoint Count at which the score equals 0.5. Must be finite.
 * @param steepness Controls how sharply the curve transitions around the midpoint. Must be finite and positive.
 */
export function sigmoidScore(count: number, midpoint: number, steepness: number): number {
  if (!Number.isFinite(midpoint) || !Number.isFinite(steepness) || steepness <= 0) {
    throw new RangeError(
      `sigmoidScore: midpoint and steepness must be finite positive numbers, got midpoint=${midpoint}, steepness=${steepness}`,
    );
  }
  if (!Number.isFinite(count) || count < 0) {
    throw new RangeError(
      `sigmoidScore: count must be a non-negative finite number, got ${count}`,
    );
  }
  return 1 / (1 + Math.exp(steepness * (count - midpoint)));
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated]`;
}

export function extractBodyHtml(html: string): string {
  const match = BODY_RE.exec(html);
  const body = match ? match[1] : html;
  return truncate(body, MAX_HTML_CHARS);
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(stripped, MAX_TEXT_CHARS);
}

/**
 * Reads the HTML content from a DOMSnapshot.
 * Prefers inline `snapshot.html` when present (test fixtures, pre-populated snapshots).
 * Falls back to reading from `snapshot.htmlPath` on disk.
 * Returns empty string when snapshot is undefined or the file cannot be read.
 */
export async function readSnapshotHtml(snapshot?: DOMSnapshot): Promise<string> {
  if (!snapshot) return '';
  if (snapshot.html !== undefined) return snapshot.html;
  if (!snapshot.htmlPath) return '';
  try {
    return await readFile(snapshot.htmlPath, 'utf-8');
  } catch (err) {
    const isNotFound = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
    const logFn = isNotFound ? console.warn : console.error;
    logFn(
      'readSnapshotHtml: failed to read snapshot HTML at',
      snapshot.htmlPath + ':',
      err instanceof Error ? err.message : String(err),
    );
    return '';
  }
}
