import { promises as fs } from 'node:fs';
import {
  isPlainObject,
  navigate,
  parseContentKey,
  resolveContentFile,
  type ContentEditError,
  type ContentPathSegment,
} from './content-editor.js';
import { ensureCollectionIds, rekeyPositionalLocks } from './content-scaffold.js';
import { readUserLocks, writeUserLocks } from './content-user-edits.js';
import { atomicWrite } from '../utils/fs-utils.js';
import { getErrorMessage } from '../utils/error.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'content-mutation' });

/** Walk `path` to its container value, or `undefined` if any segment is absent. */
function resolveContainer(doc: unknown, path: ContentPathSegment[]): unknown {
  let cursor: unknown = doc;
  for (const seg of path) {
    cursor = navigate(cursor, seg);
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

function idOf(el: unknown): string | undefined {
  return isPlainObject(el) && typeof el.id === 'string' ? el.id : undefined;
}

/**
 * Insert `item` into the array at `arrayPath`, after the element whose id is
 * `afterId` (append when omitted). The route owns identity: any caller `id` is
 * stripped, then `ensureCollectionIds` mints a fresh one for the new element and
 * any nested collection items. Returns the minted top-level id.
 */
export function insertItem(
  doc: unknown,
  arrayPath: ContentPathSegment[],
  item: unknown,
  afterId?: string,
): { id: string } | ContentEditError {
  if (!isPlainObject(item)) {
    return { code: 'invalid-item', message: 'item must be a JSON object' };
  }
  const arr: unknown = resolveContainer(doc, arrayPath);
  if (!Array.isArray(arr)) {
    return { code: 'not-an-array', message: 'collection key does not resolve to an array' };
  }
  let insertAt: number = arr.length;
  if (afterId !== undefined) {
    const idx: number = arr.findIndex((el) => idOf(el) === afterId);
    if (idx === -1) {
      return { code: 'item-not-found', message: `no item with id "${afterId}"` };
    }
    insertAt = idx + 1;
  }
  const newItem: Record<string, unknown> = { ...item };
  delete newItem.id;
  arr.splice(insertAt, 0, newItem);
  ensureCollectionIds(arr); // mints newItem.id (+ any nested collection ids)
  const mintedId: string | undefined = idOf(newItem);
  if (mintedId === undefined) {
    return { code: 'internal-error', message: 'id minting failed for inserted item' };
  }
  return { id: mintedId };
}

/** Remove the element whose id is `itemId` from the array at `arrayPath`. */
export function removeItem(
  doc: unknown,
  arrayPath: ContentPathSegment[],
  itemId: string,
): ContentEditError | null {
  const arr: unknown = resolveContainer(doc, arrayPath);
  if (!Array.isArray(arr)) {
    return { code: 'not-an-array', message: 'collection key does not resolve to an array' };
  }
  const idx: number = arr.findIndex((el) => idOf(el) === itemId);
  if (idx === -1) {
    return { code: 'item-not-found', message: `no item with id "${itemId}"` };
  }
  arr.splice(idx, 1);
  return null;
}

/**
 * Reorder the array at `arrayPath` to match `order`. `order` must be an exact
 * permutation of the array's current item ids (every element must carry a string
 * id; same set; no duplicates or extras), else `invalid-order`.
 */
export function reorderItems(
  doc: unknown,
  arrayPath: ContentPathSegment[],
  order: string[],
): ContentEditError | null {
  const arr: unknown = resolveContainer(doc, arrayPath);
  if (!Array.isArray(arr)) {
    return { code: 'not-an-array', message: 'collection key does not resolve to an array' };
  }
  // Single pass: index by id and reject any element lacking a string id.
  const byId: Map<string, unknown> = new Map();
  for (const el of arr) {
    const id: string | undefined = idOf(el);
    if (id === undefined) {
      return { code: 'invalid-order', message: 'every item must carry a string id to reorder' };
    }
    byId.set(id, el);
  }
  if (order.length !== arr.length || new Set(order).size !== order.length) {
    return { code: 'invalid-order', message: 'order must be a permutation of the current ids' };
  }
  for (const id of order) {
    if (!byId.has(id)) {
      return { code: 'invalid-order', message: `order references unknown id "${id}"` };
    }
  }
  const reordered: unknown[] = order.map((id) => byId.get(id));
  arr.splice(0, arr.length, ...reordered);
  return null;
}

export type MutateOp = 'insert' | 'remove' | 'reorder';

export interface MutateRequest {
  op: MutateOp;
  collectionKey: string;
  item?: unknown;
  afterId?: string;
  itemId?: string;
  order?: string[];
}

export type MutateResult =
  | { ok: true; file: string; id?: string }
  | { ok: false; error: ContentEditError };

export async function mutateContent(
  contentDir: string,
  request: MutateRequest,
): Promise<MutateResult> {
  const parsed = parseContentKey(request.collectionKey);
  if ('code' in parsed) return { ok: false, error: parsed };

  const file = await resolveContentFile(contentDir, parsed.rootSegment);
  if (typeof file !== 'string') return { ok: false, error: file };

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    return { ok: false, error: { code: 'read-failed', message: `could not read ${file}: ${getErrorMessage(err)}` } };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: { code: 'parse-failed', message: `invalid JSON in ${file}: ${getErrorMessage(err)}` } };
  }

  // Rekey positional [N] locks under this root to [@id] BEFORE mutating, while
  // positions still match the on-disk array — this is what lets existing
  // leaf-edit locks survive the reshuffle.
  let lockedKeys: string[];
  try {
    lockedKeys = await readUserLocks(contentDir);
  } catch (err) {
    return { ok: false, error: { code: 'read-failed', message: `could not read user locks: ${getErrorMessage(err)}` } };
  }
  const rekeyed: string[] = rekeyPositionalLocks(doc, lockedKeys, parsed.rootSegment);

  let mintedId: string | undefined;
  let finalLocks: string[] = rekeyed;

  if (request.op === 'insert') {
    const r = insertItem(doc, parsed.path, request.item, request.afterId);
    if ('code' in r) return { ok: false, error: r };
    mintedId = r.id;
  } else if (request.op === 'remove') {
    if (typeof request.itemId !== 'string') {
      return { ok: false, error: { code: 'invalid-key', message: 'itemId (string) is required for remove' } };
    }
    const e = removeItem(doc, parsed.path, request.itemId);
    if (e) return { ok: false, error: e };
    // Prune locks referencing the removed item. Scope the token to THIS
    // collection key — `.user-edits.json` is global across every content root,
    // so a bare `[@id]` token would also drop a same-id item's lock in an
    // unrelated collection (silent loss of a user edit). The collection-key
    // prefix confines the match; the trailing `]` keeps ids that share a prefix
    // distinct. Worst case is an under-prune (a stale `[@id]` lock for an absent
    // item), which `applyLocks` already drops as a dangler — benign.
    const pruneToken: string = `${request.collectionKey}[@${request.itemId}]`;
    finalLocks = rekeyed.filter((k) => !k.includes(pruneToken));
  } else if (request.op === 'reorder') {
    if (!Array.isArray(request.order)) {
      return { ok: false, error: { code: 'invalid-order', message: 'order (string[]) is required for reorder' } };
    }
    const e = reorderItems(doc, parsed.path, request.order);
    if (e) return { ok: false, error: e };
  } else {
    return { ok: false, error: { code: 'invalid-key', message: `unknown op "${String(request.op)}"` } };
  }

  try {
    await atomicWrite(file, JSON.stringify(doc, null, 2) + '\n');
  } catch (err) {
    return { ok: false, error: { code: 'write-failed', message: `could not write ${file}: ${getErrorMessage(err)}` } };
  }

  // Best-effort lock persistence (matches recordUserLock semantics): a failure
  // here is logged inside writeUserLocks and must not fail the mutation.
  const locksChanged: boolean =
    finalLocks.length !== lockedKeys.length || finalLocks.some((k, i) => k !== lockedKeys[i]);
  if (locksChanged) await writeUserLocks(contentDir, finalLocks);

  logger.info('content.mutate.success', { file, op: request.op, collectionKey: request.collectionKey, id: mintedId });
  return { ok: true, file, ...(mintedId ? { id: mintedId } : {}) };
}
