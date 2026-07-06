import { readFile } from 'node:fs/promises';
import stringify from 'safe-stable-stringify';

import type { DOMSnapshot, Turn, ToolCall } from '../runner/transcript.js';

const MAX_TEXT_CHARS = 20_000;
const MAX_HTML_CHARS = 20_000;

/**
 * Cap for HTML injected into LLM evaluator prompts.
 * ~2k tokens at ~4 chars/token, leaving headroom for transcript + goals + instructions.
 * Smaller than MAX_HTML_CHARS (20K) which is used for full-page extraction.
 */
export const LLM_PROMPT_HTML_MAX_CHARS = 8_000;

/**
 * Cap for sanitized HTML injected into LLM evaluator prompts.
 * Higher than LLM_PROMPT_HTML_MAX_CHARS because sanitization already strips
 * presentational noise, yielding denser semantic signal per character.
 * ~12.5K tokens at ~4 chars/token, well within 200K context budgets.
 */
export const LLM_PROMPT_SANITIZED_HTML_MAX_CHARS = 50_000;

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

/** Extracts body innerHTML without applying any character truncation. */
export function extractBodyHtmlFull(html: string): string {
  const match = BODY_RE.exec(html);
  return match ? match[1] : html;
}

const SVG_RE = /<svg[\s\S]*?<\/svg>/gi;
const ORPHAN_SVG_TAG_RE = /<\/?svg[^>]*>/gi;
const STYLE_ELEMENT_RE = /<style[\s\S]*?<\/style>/gi;
const SCRIPT_ELEMENT_RE = /<script[\s\S]*?<\/script>/gi;
const CLASS_ATTR_RE = /\s+class=(?:"[^"]*"|'[^']*'|[^\s>]*)/g;
const STYLE_ATTR_RE = /\s+style=(?:"[^"]*"|'[^']*'|[^\s>]*)/g;
const DATA_DEV_ATTR_RE = /\s+data-dev-[a-z0-9-]+=(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const DATA_DISCOVER_ATTR_RE = /\s+data-discover=(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const INTER_TAG_WHITESPACE_RE = />\s+</g;

/**
 * Strips presentational noise from body HTML, preserving semantic structure.
 * Strips: <svg>, <style>, <script>, class=, style=, data-dev-*, data-discover=.
 * Collapses inter-tag whitespace.
 * Preserves: href, src, alt, action, id, aria-*, role attributes and all text content.
 * @param bodyHtml - raw innerHTML of <body> (not full document HTML)
 * @returns sanitized HTML string (may be empty if body was purely presentational)
 */
export function sanitizeHtmlForEval(bodyHtml: string): string {
  return bodyHtml
    .replace(SVG_RE, '')
    .replace(ORPHAN_SVG_TAG_RE, '')
    .replace(STYLE_ELEMENT_RE, '')
    .replace(SCRIPT_ELEMENT_RE, '')
    .replace(CLASS_ATTR_RE, '')
    .replace(STYLE_ATTR_RE, '')
    .replace(DATA_DEV_ATTR_RE, '')
    .replace(DATA_DISCOVER_ATTR_RE, '')
    .replace(INTER_TAG_WHITESPACE_RE, '><')
    .trim();
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

// ---------------------------------------------------------------------------
// Transcript formatting helpers (shared across evaluator families)
// ---------------------------------------------------------------------------

const MAX_TOOL_OUTPUT_CHARS = 600;
const CONSOLE_LOG_TAIL = 30;

function turnToLine(turn: Turn): string {
  return `${turn.role.toUpperCase()}: ${(turn.content ?? '').trim()}`;
}

export function buildConversationText(turns: Turn[]): string {
  if (turns.length === 0) return '';
  return truncate(turns.map(turnToLine).join('\n'), MAX_TEXT_CHARS);
}

export function summarizeToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return '(none)';
  return truncate(
    toolCalls
      .map((tc) => {
        const status = tc.error ? `error=${tc.error}` : 'ok';
        const output = tc.output !== undefined
          ? stringify(tc.output) ?? '[unserializable]'
          : '(no output)';
        return `- ${tc.name} (${status}) input=${stringify(tc.input) ?? '[unserializable]'} output=${truncate(output, MAX_TOOL_OUTPUT_CHARS)}`;
      })
      .join('\n'),
    MAX_TEXT_CHARS,
  );
}

export async function lastSnapshotSection(snapshot?: DOMSnapshot): Promise<string> {
  if (!snapshot) return '(no snapshot)';

  const rawHtml = await readSnapshotHtml(snapshot);
  const body = extractBodyHtml(rawHtml);
  const text = htmlToText(body);
  const consoleLogs = (snapshot.consoleLogs ?? [])
    .slice(-CONSOLE_LOG_TAIL)
    .map((log) => `${log.type}: ${log.text}`)
    .join('\n');

  return [
    `URL: ${snapshot.url}`,
    snapshot.htmlPath ? `HTML_PATH: ${snapshot.htmlPath}` : '',
    '',
    'BODY_HTML:',
    body || '(empty)',
    '',
    'BODY_TEXT:',
    text || '(empty)',
    '',
    'CONSOLE_LOGS (tail):',
    consoleLogs || '(none)',
  ].join('\n');
}

/** Builds FINAL_SITE evidence using sanitized HTML (truncated to 50K chars). */
export async function lastSnapshotSectionSanitized(snapshot?: DOMSnapshot): Promise<string> {
  if (!snapshot) return '(no snapshot)';

  const rawHtml = await readSnapshotHtml(snapshot);
  const body = extractBodyHtmlFull(rawHtml);
  const sanitized = truncate(sanitizeHtmlForEval(body), LLM_PROMPT_SANITIZED_HTML_MAX_CHARS);
  const text = htmlToText(sanitized);
  const consoleLogs = (snapshot.consoleLogs ?? [])
    .slice(-CONSOLE_LOG_TAIL)
    .map((log) => `${log.type}: ${log.text}`)
    .join('\n');

  return [
    `URL: ${snapshot.url}`,
    snapshot.htmlPath ? `HTML_PATH: ${snapshot.htmlPath}` : '',
    '',
    'BODY_HTML (sanitized):',
    sanitized || '(empty)',
    '',
    'BODY_TEXT:',
    text || '(empty)',
    '',
    'CONSOLE_LOGS (tail):',
    consoleLogs || '(none)',
  ].join('\n');
}
