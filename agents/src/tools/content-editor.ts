import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Logger } from '../logging/index.js';
import { atomicWrite, fileExists } from '../utils/fs-utils.js';
import { getErrorMessage } from '../utils/error.js';
import { recordUserLock } from './content-user-edits.js';

const logger = Logger.create({ component: 'content-editor' });

export type ContentKind = 'copy' | 'richText';

export type ContentPathSegment = string | number | { id: string };

export function isIdRef(seg: ContentPathSegment): seg is { id: string } {
  return typeof seg === 'object' && seg !== null && typeof (seg as { id: unknown }).id === 'string';
}

const ID_CHARSET = /^[A-Za-z0-9_-]+$/;

export interface ContentEditRequest {
  contentKey: string;
  kind: ContentKind;
  value: string;
  /**
   * For derived content nodes (rendered through an animation/computation), the
   * rendered text the user started editing from. When set, the edit is written
   * only if the currently-stored value equals this (a pass-through render);
   * otherwise it is rejected as `derived-mismatch` to avoid corrupting a value
   * the render transforms (e.g. `formatCurrency(5)` → "$5.00").
   */
  expectedCurrent?: string;
}

export type ContentEditErrorCode =
  | 'invalid-key'
  | 'unknown-root'
  | 'missing-path'
  | 'derived-mismatch'
  | 'read-failed'
  | 'parse-failed'
  | 'write-failed'
  | 'invalid-value'
  | 'type-unsupported'
  | 'not-an-array'
  | 'item-not-found'
  | 'invalid-order'
  | 'invalid-item'
  | 'internal-error';

export interface ContentEditError {
  code: ContentEditErrorCode;
  message: string;
}

export interface ContentEditSuccess {
  ok: true;
  file: string;
  contentPath: ContentPathSegment[];
}

export type ContentEditResult = ContentEditSuccess | { ok: false; error: ContentEditError };

/**
 * Parse a content key such as `home.hero.title` or `products[3].image.alt`
 * into the root segment and the remaining path.
 *
 * Supports direct dotted access, non-negative integer list indices (`[3]`),
 * and collection-item id references (`[@id]`).
 * Returns a ContentEditError if the key is malformed or any segment matches
 * a reserved name (__proto__, constructor, prototype).
 */
export function parseContentKey(
  key: string,
): { rootSegment: string; path: ContentPathSegment[] } | ContentEditError {
  if (typeof key !== 'string' || key.length === 0) {
    return { code: 'invalid-key', message: 'content key must be a non-empty string' };
  }
  if (key.endsWith('.')) {
    return { code: 'invalid-key', message: `trailing '.' in "${key}"` };
  }

  const segments: ContentPathSegment[] = [];
  let i = 0;
  let current = '';

  while (i < key.length) {
    const ch = key[i]!;
    if (ch === '.') {
      if (current === '') {
        return { code: 'invalid-key', message: `empty segment near position ${i} in "${key}"` };
      }
      segments.push(current);
      current = '';
      i++;
    } else if (ch === '[') {
      if (current !== '') {
        segments.push(current);
        current = '';
      }
      const end = key.indexOf(']', i);
      if (end === -1) {
        return { code: 'invalid-key', message: `unclosed '[' in "${key}"` };
      }
      const inside = key.slice(i + 1, end);
      if (inside.startsWith('@')) {
        const id = inside.slice(1);
        if (!ID_CHARSET.test(id)) {
          return { code: 'invalid-key', message: `invalid id "[${inside}]" in "${key}"` };
        }
        segments.push({ id });
      } else if (/^\d+$/.test(inside)) {
        segments.push(Number(inside));
      } else {
        return { code: 'invalid-key', message: `invalid index "[${inside}]" in "${key}"` };
      }
      i = end + 1;
      if (key[i] === '.') i++;
    } else if (/[a-zA-Z0-9_]/.test(ch)) {
      current += ch;
      i++;
    } else {
      return { code: 'invalid-key', message: `invalid character "${ch}" at position ${i} in "${key}"` };
    }
  }
  if (current !== '') segments.push(current);

  const RESERVED = ['__proto__', 'constructor', 'prototype'];
  for (const seg of segments) {
    if (typeof seg === 'string' && RESERVED.includes(seg)) {
      return { code: 'invalid-key', message: `reserved segment "${seg}" in "${key}"` };
    }
  }

  const first = segments[0];
  if (segments.length === 0 || typeof first !== 'string') {
    return { code: 'invalid-key', message: `content key must start with a named root: "${key}"` };
  }

  return { rootSegment: first, path: segments.slice(1) };
}

/**
 * Resolve a content root segment to its backing file.
 * "site" maps to site.json; any other root checks pages/<root>.json first,
 * then data/<root>.json — returning the first that exists.
 */
export async function resolveContentFile(
  contentDir: string,
  rootSegment: string,
): Promise<string | ContentEditError> {
  const candidates =
    rootSegment === 'site'
      ? [path.join(contentDir, 'site.json')]
      : [
          path.join(contentDir, 'pages', `${rootSegment}.json`),
          path.join(contentDir, 'data', `${rootSegment}.json`),
        ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return {
    code: 'unknown-root',
    message: `no content file found for root "${rootSegment}" (checked ${candidates.join(', ')})`,
  };
}

/**
 * Coerce an incoming (string) edit to the type of the value already at the
 * field. Inline editing only produces text; the existing JSON value tells us
 * what type to write back so we don't corrupt numbers into strings.
 */
function coerceToExistingType(
  value: unknown,
  existing: unknown,
): { value: unknown } | ContentEditError {
  if (typeof existing === 'string') return { value };
  if (typeof existing === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return { value };
    const trimmed = typeof value === 'string' ? value.trim() : '';
    // Decimal only (leading digit required, no +prefix) — reject hex/octal/scientific
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { code: 'invalid-value', message: `"${String(value)}" is not a valid number` };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { code: 'invalid-value', message: `"${trimmed}" overflows numeric range` };
    }
    return { value: parsed };
  }
  return {
    code: 'type-unsupported',
    message: `field of type ${existing === null ? 'null' : Array.isArray(existing) ? 'array' : typeof existing} is not inline-editable`,
  };
}

/** Find the index of the array element whose `.id` equals `ref.id`, or -1. */
function indexOfId(arr: unknown[], ref: { id: string }): number {
  return arr.findIndex(
    (el) => isPlainObject(el) && (el as { id?: unknown }).id === ref.id,
  );
}

/**
 * Set a value at `path` within `doc`, in place. Returns an error if any
 * intermediate segment is missing or has the wrong type (no autovivification —
 * users edit existing fields, they don't conjure new structure).
 */
export function setAtPath(
  doc: unknown,
  pathSegments: ContentPathSegment[],
  value: unknown,
): ContentEditError | null {
  if (pathSegments.length === 0) {
    return { code: 'missing-path', message: 'cannot replace the entire document via edit' };
  }
  let cursor: unknown = doc;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const seg = pathSegments[i]!;
    const next = navigate(cursor, seg);
    if (next === undefined) {
      return {
        code: 'missing-path',
        message: `path does not exist at segment ${describePath(pathSegments.slice(0, i + 1))}`,
      };
    }
    cursor = next;
  }
  const last = pathSegments[pathSegments.length - 1]!;
  const parentPath = describePath(pathSegments.slice(0, -1));
  if (isIdRef(last)) {
    if (!Array.isArray(cursor)) {
      return { code: 'missing-path', message: `expected array at ${parentPath}` };
    }
    const idx = indexOfId(cursor, last);
    if (idx === -1) {
      return { code: 'missing-path', message: `no item with id "${last.id}" at ${parentPath}` };
    }
    const coerced = coerceToExistingType(value, cursor[idx]);
    if ('code' in coerced) return coerced;
    cursor[idx] = coerced.value;
  } else if (typeof last === 'number') {
    if (!Array.isArray(cursor)) {
      return { code: 'missing-path', message: `expected array at ${parentPath}` };
    }
    if (last >= cursor.length) {
      return { code: 'missing-path', message: `index ${last} out of range (length ${cursor.length})` };
    }
    const coerced = coerceToExistingType(value, cursor[last]);
    if ('code' in coerced) return coerced;
    cursor[last] = coerced.value;
  } else {
    if (!isPlainObject(cursor)) {
      return { code: 'missing-path', message: `expected object at ${parentPath}` };
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, last)) {
      return { code: 'missing-path', message: `field "${last}" not present at ${parentPath}` };
    }
    const target = cursor as Record<string, unknown>;
    const coerced = coerceToExistingType(value, target[last]);
    if ('code' in coerced) return coerced;
    target[last] = coerced.value;
  }
  return null;
}

/**
 * Top-level: edit a single content field in a file under `contentDir`.
 * contentDir is typically `<appPath>/src/content`.
 */
export async function editContent(
  contentDir: string,
  request: ContentEditRequest,
): Promise<ContentEditResult> {
  if (request.kind !== 'copy' && request.kind !== 'richText') {
    return { ok: false, error: { code: 'invalid-value', message: `unknown kind "${request.kind}"` } };
  }
  if (typeof request.value !== 'string') {
    return { ok: false, error: { code: 'invalid-value', message: 'value must be a string' } };
  }

  const parsed = parseContentKey(request.contentKey);
  if ('code' in parsed) return { ok: false, error: parsed };

  const file = await resolveContentFile(contentDir, parsed.rootSegment);
  if (typeof file !== 'string') return { ok: false, error: file };

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: { code: 'read-failed', message: `could not read ${file}: ${getErrorMessage(err)}` },
    };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'parse-failed', message: `invalid JSON in ${file}: ${getErrorMessage(err)}` },
    };
  }

  if (request.expectedCurrent !== undefined) {
    let cursor: unknown = doc;
    for (const seg of parsed.path) {
      cursor = navigate(cursor, seg);
    }
    // Only guard scalar values: a missing/object/array/null value falls through
    // so setAtPath produces the existing error codes (missing-path / type-unsupported).
    if (typeof cursor === 'string' || typeof cursor === 'number' || typeof cursor === 'boolean') {
      function normalize(s: string): string {
        return s.replace(/\s+/g, ' ').trim();
      }
      if (normalize(String(cursor)) !== normalize(request.expectedCurrent)) {
        return {
          ok: false,
          error: {
            code: 'derived-mismatch',
            message:
              'stored content value no longer matches the text being edited; the displayed value is computed or animated, so the edit was not applied',
          },
        };
      }
    }
  }

  const setError = setAtPath(doc, parsed.path, request.value);
  if (setError) return { ok: false, error: setError };

  const serialized = JSON.stringify(doc, null, 2) + '\n';
  try {
    await atomicWrite(file, serialized);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'write-failed', message: `could not write ${file}: ${getErrorMessage(err)}` },
    };
  }

  // Record the edited key as user-locked so the scaffold engine's
  // replace-except-user-locked merge preserves this value when the agent later
  // regenerates the content root. Best-effort: never throws, and a failure here
  // must not affect the returned edit result.
  const locked = await recordUserLock(contentDir, request.contentKey);

  logger.info('content.edit.success', {
    file,
    contentKey: request.contentKey,
    kind: request.kind,
    locked,
  });

  return { ok: true, file, contentPath: parsed.path };
}

export function navigate(cursor: unknown, seg: ContentPathSegment): unknown {
  if (isIdRef(seg)) {
    if (!Array.isArray(cursor)) return undefined;
    const idx = indexOfId(cursor, seg);
    return idx === -1 ? undefined : cursor[idx];
  }
  if (typeof seg === 'number') {
    return Array.isArray(cursor) ? cursor[seg] : undefined;
  }
  if (!isPlainObject(cursor)) return undefined;
  return Object.prototype.hasOwnProperty.call(cursor, seg)
    ? (cursor as Record<string, unknown>)[seg]
    : undefined;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describePath(segments: ContentPathSegment[]): string {
  if (segments.length === 0) return '<root>';
  return segments
    .map((s) => (typeof s === 'number' ? `[${s}]` : isIdRef(s) ? `[@${s.id}]` : `.${s}`))
    .join('')
    .replace(/^\./, '');
}
