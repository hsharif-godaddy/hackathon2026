import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Logger } from '../logging/index.js';
import { atomicWrite } from '../utils/fs-utils.js';
import { getErrorMessage } from '../utils/error.js';

const logger = Logger.create({ component: 'content-user-edits' });

/**
 * Single source of truth for the user-edit provenance lock file. The inline-edit
 * path writes to it (`recordUserLock`) and the scaffold engine reads from it
 * (`readUserLocks`) — keeping both sides here guarantees the on-disk format can
 * never drift between writer and reader.
 *
 * The file is `<contentDir>/.user-edits.json`, shape `{ "lockedKeys": string[] }`.
 * It is a dotfile so the customer-app content plugin's layout validator ignores
 * it rather than treating it as a stray content file.
 */
export const USER_EDITS_FILE = '.user-edits.json';

/**
 * Read the user-lock record at `<contentDir>/.user-edits.json` and return its
 * `lockedKeys`. Returns `[]` for an absent file (normal), a parse error
 * (corrupt lockfile), or an unexpected shape; non-string entries are filtered
 * out. Throws on any other read error (EACCES/EMFILE/EIO/…) so callers can
 * fail safe rather than treat a transient failure as "no locks" and overwrite
 * user-edited content.
 */
export async function readUserLocks(contentDir: string): Promise<string[]> {
  const lockFile = path.join(contentDir, USER_EDITS_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(lockFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; // absent is normal
    logger.warn('content_userEdits.read.failed', { error: getErrorMessage(err) });
    throw err; // transient read error — let the caller fail safe
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn('content_userEdits.parse.failed', { error: getErrorMessage(err) });
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const lockedKeys = (parsed as Record<string, unknown>).lockedKeys;
  if (!Array.isArray(lockedKeys)) return [];
  return lockedKeys.filter((k): k is string => typeof k === 'string');
}

/**
 * Record `contentKey` as user-locked in `<contentDir>/.user-edits.json`. Reads
 * the existing locks, adds the key if absent, sorts for a stable diff, and
 * atomically writes back `{ lockedKeys: [...] }` as pretty JSON with a trailing
 * newline.
 *
 * Best-effort: never throws. Returns `true` on a successful write, `false` on
 * any failure (logged via `content_userEdits.record.failed`). The caller treats
 * a `false` as a missed lock — the edit itself still succeeds and is committed.
 *
 * Consequence of a missed lock (write failure, or a lost update from two near-
 * simultaneous edits racing this read-modify-write): the user's edit is on disk
 * + in git history, but unprotected — a later `mode:'merge'` re-scaffold of that
 * root will overwrite it with no signal. Acceptable today (single-user sessions
 * make the race unlikely, and the value is recoverable from git); harden with a
 * per-app lock if concurrent editing becomes real.
 */
export async function recordUserLock(contentDir: string, contentKey: string): Promise<boolean> {
  try {
    const existing = await readUserLocks(contentDir);
    if (existing.includes(contentKey)) return true;
    const lockedKeys = [...existing, contentKey].sort();
    const lockFile = path.join(contentDir, USER_EDITS_FILE);
    await atomicWrite(lockFile, JSON.stringify({ lockedKeys }, null, 2) + '\n');
    return true;
  } catch (err) {
    logger.warn('content_userEdits.record.failed', {
      contentDir,
      contentKey,
      error: getErrorMessage(err),
    });
    return false;
  }
}
