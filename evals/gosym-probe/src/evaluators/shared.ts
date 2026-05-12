import { readFile } from 'node:fs/promises';

import type { DOMSnapshot } from '../runner/transcript.js';

const MAX_TEXT_CHARS = 20_000;
const MAX_HTML_CHARS = 20_000;

const BODY_RE = /<body[^>]*>([\s\S]*)<\/body>/i;

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
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
 * Reads the HTML content from a DOMSnapshot's htmlPath.
 * Returns empty string when snapshot is undefined or the file cannot be read.
 */
export async function readSnapshotHtml(snapshot?: DOMSnapshot): Promise<string> {
  if (!snapshot?.htmlPath) return '';
  try {
    return await readFile(snapshot.htmlPath, 'utf-8');
  } catch (err) {
    console.warn(
      'readSnapshotHtml: failed to read snapshot HTML at',
      snapshot.htmlPath + ':',
      err instanceof Error ? err.message : String(err),
    );
    return '';
  }
}
